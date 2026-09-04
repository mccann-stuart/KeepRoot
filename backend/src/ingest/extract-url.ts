import { Readability } from '@mozilla/readability';
import { DOMParser } from 'linkedom';
import { renderPageWithBrowser, type BrowserRenderReason } from './browser';
import { createArticleTurndownService } from './article-media';
import { fetchWithRedirects, validateSafeUrl, type BookmarkImagePayload } from '../storage/shared';

export interface BrowserExtractionDetails {
	browserMsUsed?: number;
	engine: 'chromium' | 'kitesurf';
	method: 'browser' | 'static';
	reason: BrowserRenderReason;
	screenshotCaptured: boolean;
	status: 'failed' | 'succeeded' | 'unavailable';
}

export interface ExtractedBookmarkPayload {
	browserExtraction?: BrowserExtractionDetails;
	htmlData?: string;
	images?: BookmarkImagePayload[];
	lang?: string | null;
	markdownData: string;
	siteName?: string | null;
	textContent: string;
	title: string;
	url: string;
}

export interface ExtractBookmarkPayloadInput {
	browser?: BrowserRun;
	browserFetchImpl?: typeof fetch;
	browserRunAccountId?: string;
	browserRunApiToken?: string;
	browserRunEngine?: string;
	captureScreenshot?: boolean;
	fallbackTitle?: string;
	fetchImpl?: typeof fetch;
	render?: boolean;
	url: string;
}

interface ExtractedHtmlBookmark extends ExtractedBookmarkPayload {
	readabilitySucceeded: boolean;
}

interface StructuredArticleBody {
	body: string;
	headline?: string;
}

interface StructuredHeroCandidate {
	priority: number;
	url: string;
}

interface ParentNodeLike {
	parentNode?: ParentNodeLike | null;
}

interface SemanticElementLike extends ParentNodeLike {
	outerHTML: string;
	textContent?: string | null;
}

type ParsedHtmlDocument = ReturnType<DOMParser['parseFromString']>;

const PDF_VIEWER_PARAM_KEYS = ['src', 'file', 'url'];
const PDF_CONTENT_TYPES = new Set(['application/pdf']);
const NO_EXTRACTABLE_TEXT_MARKDOWN = '_No extractable text was found in this PDF. OCR is not currently supported._';
const MIN_USEFUL_TEXT_LENGTH = 280;
const VERY_SHORT_TEXT_LENGTH = 80;
const JS_SHELL_MARKERS = [
	/<(?:div|main)[^>]+id=["'](?:__next|app|root)["']/i,
	/<script[^>]+type=["']module["']/i,
	/\b(?:__NEXT_DATA__|__NUXT__|data-reactroot|webpackJsonp)\b/i,
	/<noscript[^>]*>[\s\S]{0,300}(?:enable|requires?)\s+javascript/i,
];
const STRUCTURED_ARTICLE_TYPES = new Set([
	'Article',
	'BlogPosting',
	'LiveBlogPosting',
	'NewsArticle',
	'ReportageNewsArticle',
]);
const STRUCTURED_WEB_PAGE_TYPES = new Set(['CollectionPage', 'ItemPage', 'ProfilePage', 'WebPage']);
const STRUCTURED_BODY_ADVANTAGE_LENGTH = 80;

function normalizePdfText(rawText: string): string {
	return String(rawText ?? '')
		.replace(/\u0000/g, '')
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function titleFromUrl(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return 'Untitled';
	}
}

function extractTextFromPdfItems(items: Array<{ hasEOL?: boolean; str?: string }>): string {
	const parts: string[] = [];
	for (const item of items) {
		const text = normalizePdfText(item?.str ?? '');
		if (text) {
			if (parts.length && parts[parts.length - 1] !== '\n') {
				parts.push(' ');
			}
			parts.push(text);
		}

		if (item?.hasEOL && parts[parts.length - 1] !== '\n') {
			parts.push('\n');
		}
	}

	return normalizePdfText(parts.join(''));
}

function buildPdfMarkdown(pages: Array<{ pageNumber: number; text: string }>): string {
	const normalizedPages = pages
		.map((page) => ({
			pageNumber: page.pageNumber,
			text: normalizePdfText(page.text),
		}))
		.filter((page) => page.text);

	if (!normalizedPages.length) {
		return NO_EXTRACTABLE_TEXT_MARKDOWN;
	}

	if (normalizedPages.length === 1) {
		return normalizedPages[0].text;
	}

	return normalizedPages
		.map((page) => `## Page ${page.pageNumber}\n\n${page.text}`)
		.join('\n\n');
}

function normalizeContentType(contentType: string | null): string {
	return String(contentType ?? '')
		.split(';', 1)[0]
		.trim()
		.toLowerCase();
}

function resolvePdfSourceUrl(rawUrl: string): string {
	if (!rawUrl.trim()) {
		return '';
	}

	try {
		const parsedUrl = new URL(rawUrl);
		if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
			return parsedUrl.toString();
		}

		for (const paramKey of PDF_VIEWER_PARAM_KEYS) {
			const candidate = parsedUrl.searchParams.get(paramKey);
			if (!candidate) {
				continue;
			}

			try {
				const resolvedUrl = new URL(candidate, parsedUrl).toString();
				const protocol = new URL(resolvedUrl).protocol;
				if (protocol === 'http:' || protocol === 'https:') {
					return resolvedUrl;
				}
			} catch {
				continue;
			}
		}

		return rawUrl;
	} catch {
		return rawUrl;
	}
}

function isLikelyPdfUrl(rawUrl: string): boolean {
	const resolvedUrl = resolvePdfSourceUrl(rawUrl);
	if (!resolvedUrl) {
		return false;
	}

	try {
		const parsedUrl = new URL(resolvedUrl);
		return decodeURIComponent(parsedUrl.pathname).toLowerCase().endsWith('.pdf');
	} catch {
		return false;
	}
}

function filenameTitleFromUrl(url: string): string | null {
	try {
		const parsedUrl = new URL(url);
		const filename = decodeURIComponent(parsedUrl.pathname.split('/').pop() ?? '').trim();
		return filename || null;
	} catch {
		return null;
	}
}

function sanitizeTitleCandidate(value: string | null | undefined): string | null {
	const trimmed = String(value ?? '').trim();
	if (!trimmed || /^untitled$/i.test(trimmed)) {
		return null;
	}

	const normalized = trimmed.replace(/\.pdf$/i, '').trim();
	return normalized || null;
}

function derivePdfTitle(url: string, fallbackTitle?: string, metadataTitle?: string | null): string {
	return sanitizeTitleCandidate(metadataTitle)
		|| sanitizeTitleCandidate(fallbackTitle)
		|| sanitizeTitleCandidate(filenameTitleFromUrl(url))
		|| 'Untitled PDF';
}

async function extractPdfBookmark(url: string, pdfBytes: Uint8Array, fallbackTitle?: string): Promise<ExtractedBookmarkPayload> {
	const { VerbosityLevel, getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const loadingTask = getDocument({
		data: pdfBytes,
		disableFontFace: true,
		isImageDecoderSupported: false,
		isOffscreenCanvasSupported: false,
		useWorkerFetch: false,
		verbosity: VerbosityLevel.ERRORS,
	});

	try {
		const document = await loadingTask.promise;
		let metadataTitle: string | null = null;
		try {
			const metadata = await document.getMetadata();
			metadataTitle = (metadata?.info as Record<string, unknown> | undefined)?.Title as string | null ?? null;
		} catch {
			metadataTitle = null;
		}

		const pagePromises = Array.from({ length: document.numPages }, async (_, index) => {
			const pageNumber = index + 1;
			const page = await document.getPage(pageNumber);
			try {
				const textContent = await page.getTextContent();
				const pageText = extractTextFromPdfItems((textContent.items ?? []) as Array<{ hasEOL?: boolean; str?: string }>);
				return { pageNumber, text: pageText };
			} finally {
				page.cleanup();
			}
		});

		const pages = (await Promise.all(pagePromises)).filter(
			(page): page is { pageNumber: number; text: string } => Boolean(page.text)
		);

		const markdownData = buildPdfMarkdown(pages);
		return {
			lang: null,
			markdownData,
			textContent: markdownData,
			title: derivePdfTitle(url, fallbackTitle, metadataTitle),
			url,
		};
	} finally {
		await loadingTask.destroy();
	}
}

function htmlToPlainText(html: string): string {
	const document = new DOMParser().parseFromString(html, 'text/html');
	for (const element of document.querySelectorAll('script, style')) {
		element.remove();
	}
	return normalizeWhitespace(document.body?.textContent ?? document.documentElement?.textContent ?? '');
}

function structuredArticleType(record: Record<string, unknown>): boolean {
	return structuredTypeNames(record).some((type) => STRUCTURED_ARTICLE_TYPES.has(type));
}

function structuredTypeNames(record: Record<string, unknown>): string[] {
	const rawTypes = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
	return rawTypes.flatMap((type) => {
		if (typeof type !== 'string') {
			return [];
		}
		return [type.split(/[\/#]/).pop() ?? type];
	});
}

function elementDepth(element: ParentNodeLike): number {
	let depth = 0;
	let current = element.parentNode;
	while (current) {
		depth += 1;
		current = current.parentNode;
	}
	return depth;
}

function selectSemanticArticleHtml(document: ParsedHtmlDocument): string | null {
	const elements = document.querySelectorAll(
		'main article, main [role="article"], [role="main"] article, [role="main"] [role="article"], article[role="article"]',
	) as unknown as ArrayLike<SemanticElementLike>;
	const candidates = Array.from(elements)
		.map((element) => ({
			depth: elementDepth(element),
			element,
			textLength: normalizeWhitespace(element.textContent ?? '').length,
		}))
		.filter((candidate) => candidate.textLength >= MIN_USEFUL_TEXT_LENGTH);
	if (!candidates.length) {
		return null;
	}

	const longestTextLength = Math.max(...candidates.map((candidate) => candidate.textLength));
	const viableCandidates = candidates
		.filter((candidate) => candidate.textLength >= longestTextLength * 0.75)
		.sort((left, right) => right.depth - left.depth || left.textLength - right.textLength);
	return viableCandidates[0]?.element.outerHTML ?? null;
}

function extractIsolatedSemanticArticle(articleHtml: string | null, title: string) {
	if (!articleHtml) {
		return null;
	}

	const isolatedDocument = new DOMParser().parseFromString(
		`<html><head><title></title></head><body>${articleHtml}</body></html>`,
		'text/html',
	);
	const titleNode = isolatedDocument.querySelector('title');
	if (titleNode) {
		titleNode.textContent = title;
	}
	return new Readability(isolatedDocument as never).parse();
}

function structuredArticleCandidates(value: unknown): StructuredArticleBody[] {
	const candidates: StructuredArticleBody[] = [];
	const pending: unknown[] = [value];
	let examined = 0;

	while (pending.length && examined < 1_000) {
		const current = pending.pop();
		examined += 1;
		if (Array.isArray(current)) {
			pending.push(...current);
			continue;
		}
		if (!current || typeof current !== 'object') {
			continue;
		}

		const record = current as Record<string, unknown>;
		if (structuredArticleType(record) && typeof record.articleBody === 'string' && record.articleBody.trim()) {
			candidates.push({
				body: normalizePdfText(record.articleBody),
				headline: typeof record.headline === 'string' ? normalizeWhitespace(record.headline) : undefined,
			});
		}
		pending.push(...Object.values(record));
	}

	return candidates;
}

function extractStructuredData(document: ParsedHtmlDocument): unknown[] {
	const values: unknown[] = [];
	for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
		const rawJson = script.textContent?.trim();
		if (!rawJson) {
			continue;
		}
		try {
			values.push(JSON.parse(rawJson));
		} catch {
			// Invalid publisher metadata should not block the normal Readability path.
		}
	}
	return values;
}

function extractStructuredArticle(values: unknown[]): StructuredArticleBody | null {
	const candidates = values.flatMap((value) => structuredArticleCandidates(value));

	return candidates.sort((left, right) => right.body.length - left.body.length)[0] ?? null;
}

function schemaImageUrls(value: unknown): string[] {
	if (typeof value === 'string') {
		return [value];
	}
	if (Array.isArray(value)) {
		return value.flatMap((item) => schemaImageUrls(item));
	}
	if (!value || typeof value !== 'object') {
		return [];
	}

	const record = value as Record<string, unknown>;
	return ['contentUrl', 'url', '@id'].flatMap((key) => typeof record[key] === 'string' ? [record[key] as string] : []);
}

function structuredHeroCandidates(value: unknown): StructuredHeroCandidate[] {
	const candidates: StructuredHeroCandidate[] = [];
	const pending: unknown[] = [value];
	let examined = 0;

	while (pending.length && examined < 1_000) {
		const current = pending.pop();
		examined += 1;
		if (Array.isArray(current)) {
			pending.push(...current);
			continue;
		}
		if (!current || typeof current !== 'object') {
			continue;
		}

		const record = current as Record<string, unknown>;
		const types = structuredTypeNames(record);
		const priority = types.some((type) => STRUCTURED_ARTICLE_TYPES.has(type))
			? 0
			: types.some((type) => STRUCTURED_WEB_PAGE_TYPES.has(type))
				? 1
				: 2;
		for (const key of ['image', 'primaryImageOfPage', 'thumbnailUrl']) {
			for (const url of schemaImageUrls(record[key])) {
				candidates.push({ priority, url });
			}
		}
		pending.push(...Object.values(record));
	}

	return candidates;
}

function resolveHttpUrl(rawUrl: string | null | undefined, pageUrl: string): string | null {
	if (!rawUrl?.trim()) {
		return null;
	}

	try {
		const resolved = new URL(rawUrl, pageUrl);
		return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : null;
	} catch {
		return null;
	}
}

function metadataImageCandidates(document: ParsedHtmlDocument): string[] {
	const openGraph: string[] = [];
	const twitter: string[] = [];
	for (const meta of document.querySelectorAll('meta')) {
		const key = (meta.getAttribute('property') ?? meta.getAttribute('name') ?? '').trim().toLowerCase();
		const content = meta.getAttribute('content')?.trim();
		if (!content) {
			continue;
		}
		if (key === 'og:image' || key === 'og:image:url' || key === 'og:image:secure_url') {
			openGraph.push(content);
		} else if (key === 'twitter:image' || key === 'twitter:image:src') {
			twitter.push(content);
		}
	}

	const imageSourceLinks: string[] = [];
	for (const link of document.querySelectorAll('link')) {
		if (!(link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('image_src')) {
			continue;
		}
		const href = link.getAttribute('href')?.trim();
		if (href) {
			imageSourceLinks.push(href);
		}
	}
	return [...openGraph, ...twitter, ...imageSourceLinks];
}

function extractLeadImageUrl(document: ParsedHtmlDocument, structuredValues: unknown[], pageUrl: string): string | null {
	const structuredCandidates = structuredValues
		.flatMap((value) => structuredHeroCandidates(value))
		.sort((left, right) => left.priority - right.priority)
		.map((candidate) => candidate.url);

	for (const candidate of [...structuredCandidates, ...metadataImageCandidates(document)]) {
		const resolved = resolveHttpUrl(candidate, pageUrl);
		if (resolved) {
			return resolved;
		}
	}
	return null;
}

function markdownContainsImage(markdown: string, imageUrl: string, pageUrl: string): boolean {
	const imagePattern = /!\[[^\]]*]\((?:<)?([^\s)>]+)(?:>)?(?:\s+["'][^"']*["'])?\)/g;
	let match: RegExpExecArray | null = imagePattern.exec(markdown);
	while (match) {
		if (resolveHttpUrl(match[1], pageUrl) === imageUrl) {
			return true;
		}
		match = imagePattern.exec(markdown);
	}
	return false;
}

function prependLeadImage(markdown: string, imageUrl: string | null, pageUrl: string): string {
	if (!imageUrl || markdownContainsImage(markdown, imageUrl, pageUrl)) {
		return markdown;
	}
	return `![Article image](${imageUrl})\n\n${markdown}`.trim();
}

function embeddedMediaLabel(rawUrl: string): string {
	try {
		const hostname = new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
		if (hostname === 'bsky.app' || hostname === 'embed.bsky.app') {
			return 'View embedded Bluesky post';
		}
		if (hostname === 'x.com' || hostname === 'twitter.com') {
			return 'View embedded post on X';
		}
	} catch {
		return 'View embedded media';
	}
	return 'View embedded media';
}

function replaceStructuredMediaMarkers(value: string, replacement: (url: string, label: string) => string): string {
	return value.replace(/\[Media:\s*(https?:\/\/[^\]\s]+)\s*\]/gi, (_match, url: string) =>
		replacement(url, embeddedMediaLabel(url))
	);
}

function structuredArticleMarkdown(body: string): string {
	return replaceStructuredMediaMarkers(body, (url, label) => `[${label}](${url})`)
		.replace(/\[Image:\s*(https?:\/\/[^\]\s]+)\s*\]/gi, (_match, url: string) => `![Article image](${url})`);
}

function structuredArticleText(body: string): string {
	return normalizePdfText(
		replaceStructuredMediaMarkers(body, (_url, label) => label)
			.replace(/\[Image:\s*https?:\/\/[^\]\s]+\s*\]/gi, 'Article image'),
	);
}

function hasMaterialContentAdvantage(candidateText: string, currentText: string): boolean {
	const candidate = normalizeWhitespace(candidateText);
	const current = normalizeWhitespace(currentText);
	return candidate.length >= MIN_USEFUL_TEXT_LENGTH
		&& candidate.length >= current.length + STRUCTURED_BODY_ADVANTAGE_LENGTH;
}

function fallbackExtractHtmlBookmark(html: string, url: string, fallbackTitle?: string): ExtractedHtmlBookmark {
	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const headingMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
	const textContent = htmlToPlainText(html);
	const title = normalizePdfText(headingMatch?.[1] ?? titleMatch?.[1] ?? fallbackTitle ?? 'Untitled') || 'Untitled';
	const markdownData = textContent || title;

	return {
		htmlData: html,
		lang: null,
		markdownData,
		readabilitySucceeded: false,
		siteName: null,
		textContent: markdownData,
		title,
		url,
	};
}

function extractHtmlBookmark(html: string, url: string, fallbackTitle?: string): ExtractedHtmlBookmark {
	try {
		const document = new DOMParser().parseFromString(html, 'text/html');
		const turndownService = createArticleTurndownService();
		const structuredValues = extractStructuredData(document);
		const structuredArticle = extractStructuredArticle(structuredValues);
		const leadImageUrl = extractLeadImageUrl(document, structuredValues, url);
		const titleNodeText = document.querySelector('title')?.textContent?.trim() ?? '';
		const semanticArticleHtml = selectSemanticArticleHtml(document);
		const siteName = normalizeWhitespace(
			document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')
				?? document.querySelector('meta[name="application-name"]')?.getAttribute('content')
				?? document.querySelector('meta[name="publisher"]')?.getAttribute('content')
				?? '',
		) || null;
		const lang = document.documentElement?.getAttribute('lang');
		const originalBodyHtml = document.body?.innerHTML?.trim() || html;
		// Readability mutates the document, so capture metadata and the fallback body
		// before parsing it.
		const readability = new Readability(document as never);
		let article = readability.parse();
		const initialReadabilityText = article?.textContent ?? '';
		const useStructuredArticle = structuredArticle
			? hasMaterialContentAdvantage(structuredArticle.body, initialReadabilityText)
			: false;
		if (!useStructuredArticle) {
			const semanticArticle = extractIsolatedSemanticArticle(
				semanticArticleHtml,
				fallbackTitle?.trim() || structuredArticle?.headline || titleNodeText || 'Untitled',
			);
			if (semanticArticle && hasMaterialContentAdvantage(
				semanticArticle.textContent ?? '',
				initialReadabilityText,
			)) {
				article = semanticArticle;
			}
		}
		const articleHtml = article?.content?.trim() || originalBodyHtml;
		const articleRoot = new DOMParser()
			.parseFromString(`<article>${articleHtml}</article>`, 'text/html')
			.querySelector('article');
		const markdownData = articleRoot
			? turndownService.turndown(articleRoot).trim() || htmlToPlainText(articleHtml)
			: htmlToPlainText(articleHtml);
		const textContent = normalizePdfText(
			article?.textContent?.trim()
				|| htmlToPlainText(articleHtml)
				|| markdownData,
		);
		const selectedMarkdownData = useStructuredArticle
			? structuredArticleMarkdown(structuredArticle!.body)
			: markdownData;
		return {
			htmlData: html,
			lang,
			markdownData: prependLeadImage(selectedMarkdownData, leadImageUrl, url),
			readabilitySucceeded: Boolean(article?.content?.trim() || useStructuredArticle),
			siteName,
			textContent: useStructuredArticle
				? structuredArticleText(structuredArticle!.body)
				: textContent,
			title: article?.title?.trim()
				|| structuredArticle?.headline
				|| fallbackTitle?.trim()
				|| titleNodeText
				|| 'Untitled',
			url,
		};
	} catch {
		return fallbackExtractHtmlBookmark(html, url, fallbackTitle);
	}
}

export function extractHtmlContent(url: string, html: string, fallbackTitle?: string): ExtractedBookmarkPayload {
	const { readabilitySucceeded: _readabilitySucceeded, ...payload } = extractHtmlBookmark(html, url, fallbackTitle);
	return payload;
}

function extractPlainTextBookmark(text: string, url: string, fallbackTitle?: string): ExtractedBookmarkPayload {
	const textContent = normalizeWhitespace(text);
	return {
		lang: null,
		markdownData: textContent || '_No extractable text was found._',
		siteName: null,
		textContent,
		title: fallbackTitle?.trim() || titleFromUrl(url),
		url,
	};
}

function browserRenderReason(
	html: string,
	extracted: ExtractedHtmlBookmark,
	input: Pick<ExtractBookmarkPayloadInput, 'captureScreenshot' | 'render'>,
): BrowserRenderReason | null {
	if (input.captureScreenshot) {
		return 'screenshot';
	}
	if (input.render === true) {
		return 'explicit';
	}
	if (input.render === false) {
		return null;
	}

	const textLength = extracted.textContent.trim().length;
	if (textLength < MIN_USEFUL_TEXT_LENGTH && JS_SHELL_MARKERS.some((marker) => marker.test(html))) {
		return 'js_shell';
	}
	if (!extracted.readabilitySucceeded && textLength < VERY_SHORT_TEXT_LENGTH && html.length > 1_000) {
		return 'low_content';
	}

	return null;
}

function logBrowserExtraction(details: BrowserExtractionDetails, staticTextLength: number, renderedTextLength?: number): void {
	console.info(JSON.stringify({
		browserMsUsed: details.browserMsUsed,
		event: 'browser_render_extraction',
		engine: details.engine,
		method: details.method,
		reason: details.reason,
		renderedTextLength,
		screenshotCaptured: details.screenshotCaptured,
		staticTextLength,
		status: details.status,
	}));
}

function safeBrowserErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/https?:\/\/\S+/gi, '[url]').slice(0, 400);
}

function browserEngineForInput(input: ExtractBookmarkPayloadInput): 'chromium' | 'kitesurf' {
	return input.browserRunEngine?.trim().toLowerCase() === 'kitesurf' ? 'kitesurf' : 'chromium';
}

function hasBrowserTransport(input: ExtractBookmarkPayloadInput): boolean {
	return browserEngineForInput(input) === 'kitesurf'
		? Boolean(input.browserRunAccountId && input.browserRunApiToken)
		: Boolean(input.browser);
}

function makeScreenshotImage(dataBase64: string): BookmarkImagePayload {
	return {
		contentType: 'image/png',
		dataBase64,
		variant: 'screenshot',
	};
}

function logBrowserFailure(error: unknown, reason: BrowserRenderReason): void {
	console.warn(JSON.stringify({
		error: safeBrowserErrorMessage(error),
		event: 'browser_render_extraction_failed',
		reason,
	}));
}

async function renderHtmlWithBrowser(
	input: ExtractBookmarkPayloadInput,
	url: string,
	reason: BrowserRenderReason,
	staticExtraction?: ExtractedHtmlBookmark,
	staticError?: Error,
): Promise<ExtractedBookmarkPayload> {
	const requestedEngine = browserEngineForInput(input);
	if (!hasBrowserTransport(input)) {
		const browserExtraction: BrowserExtractionDetails = {
			engine: requestedEngine,
			method: 'static',
			reason,
			screenshotCaptured: false,
			status: 'unavailable',
		};
		logBrowserExtraction(browserExtraction, staticExtraction?.textContent.length ?? 0);
		if (staticExtraction) {
			return { ...staticExtraction, browserExtraction };
		}
		throw staticError ?? new Error('Browser Run is unavailable');
	}

	try {
		const renderedPage = await renderPageWithBrowser({
			accountId: input.browserRunAccountId,
			apiToken: input.browserRunApiToken,
			browser: input.browser,
			captureScreenshot: input.captureScreenshot,
			engine: input.browserRunEngine,
			fetchImpl: input.browserFetchImpl,
			url,
		});
		const renderedExtraction = extractHtmlBookmark(renderedPage.html, url, input.fallbackTitle);
		const browserExtraction: BrowserExtractionDetails = {
			browserMsUsed: renderedPage.browserMsUsed,
			engine: renderedPage.engine,
			method: 'browser',
			reason,
			screenshotCaptured: Boolean(renderedPage.screenshotBase64),
			status: 'succeeded',
		};
		logBrowserExtraction(
			browserExtraction,
			staticExtraction?.textContent.length ?? 0,
			renderedExtraction.textContent.length,
		);

		return {
			...renderedExtraction,
			browserExtraction,
			images: renderedPage.screenshotBase64
				? [makeScreenshotImage(renderedPage.screenshotBase64)]
				: undefined,
		};
	} catch (error) {
		const browserExtraction: BrowserExtractionDetails = {
			engine: requestedEngine,
			method: 'static',
			reason,
			screenshotCaptured: false,
			status: 'failed',
		};
		logBrowserFailure(error, reason);
		logBrowserExtraction(browserExtraction, staticExtraction?.textContent.length ?? 0);
		if (staticExtraction) {
			return { ...staticExtraction, browserExtraction };
		}
		throw staticError ?? error;
	}
}

async function captureScreenshotForStaticPayload(
	input: ExtractBookmarkPayloadInput,
	url: string,
	staticExtraction: ExtractedBookmarkPayload,
): Promise<ExtractedBookmarkPayload> {
	const requestedEngine = browserEngineForInput(input);
	if (!hasBrowserTransport(input)) {
		const browserExtraction: BrowserExtractionDetails = {
			engine: requestedEngine,
			method: 'static',
			reason: 'screenshot',
			screenshotCaptured: false,
			status: 'unavailable',
		};
		logBrowserExtraction(browserExtraction, staticExtraction.textContent.length);
		return { ...staticExtraction, browserExtraction };
	}

	try {
		const renderedPage = await renderPageWithBrowser({
			accountId: input.browserRunAccountId,
			apiToken: input.browserRunApiToken,
			browser: input.browser,
			captureScreenshot: true,
			engine: input.browserRunEngine,
			fetchImpl: input.browserFetchImpl,
			url,
		});
		const browserExtraction: BrowserExtractionDetails = {
			browserMsUsed: renderedPage.browserMsUsed,
			engine: renderedPage.engine,
			method: 'browser',
			reason: 'screenshot',
			screenshotCaptured: true,
			status: 'succeeded',
		};
		logBrowserExtraction(browserExtraction, staticExtraction.textContent.length);
		return {
			...staticExtraction,
			browserExtraction,
			images: [makeScreenshotImage(renderedPage.screenshotBase64 as string)],
		};
	} catch (error) {
		const browserExtraction: BrowserExtractionDetails = {
			engine: requestedEngine,
			method: 'static',
			reason: 'screenshot',
			screenshotCaptured: false,
			status: 'failed',
		};
		logBrowserFailure(error, 'screenshot');
		logBrowserExtraction(browserExtraction, staticExtraction.textContent.length);
		return { ...staticExtraction, browserExtraction };
	}
}

export async function extractBookmarkPayloadFromUrl(input: ExtractBookmarkPayloadInput): Promise<ExtractedBookmarkPayload> {
	if (!await validateSafeUrl(input.url)) {
		throw new Error('Unsafe initial URL');
	}

	let { response, currentUrl, errorText } = await fetchWithRedirects(
		input.url,
		{
			headers: {
				Accept: 'text/html,application/pdf,text/plain,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'User-Agent': 'KeepRoot/1.0 (+https://keeproot.local)',
			},
		},
		input.fetchImpl ?? fetch
	);

	if (errorText) {
		throw new Error(errorText);
	}

	if (!response || !response.ok) {
		const staticError = new Error(`Failed to fetch URL (${response?.status ?? 'Unknown'})`);
		if (input.render === true || input.captureScreenshot) {
			return renderHtmlWithBrowser(
				input,
				currentUrl,
				input.captureScreenshot ? 'screenshot' : 'explicit',
				undefined,
				staticError,
			);
		}
		throw staticError;
	}

	const finalUrl = resolvePdfSourceUrl(response.url || currentUrl);
	const contentType = normalizeContentType(response.headers.get('content-type'));
	if (PDF_CONTENT_TYPES.has(contentType) || (contentType === 'application/octet-stream' && isLikelyPdfUrl(finalUrl)) || isLikelyPdfUrl(finalUrl)) {
		const pdfBytes = new Uint8Array(await response.arrayBuffer());
		const staticExtraction = await extractPdfBookmark(finalUrl, pdfBytes, input.fallbackTitle);
		return input.captureScreenshot
			? captureScreenshotForStaticPayload(input, finalUrl, staticExtraction)
			: staticExtraction;
	}

	if (contentType === 'text/plain') {
		const staticExtraction = extractPlainTextBookmark(await response.text(), finalUrl, input.fallbackTitle);
		return input.captureScreenshot
			? captureScreenshotForStaticPayload(input, finalUrl, staticExtraction)
			: staticExtraction;
	}

	const html = await response.text();
	const staticExtraction = extractHtmlBookmark(html, finalUrl, input.fallbackTitle);
	const reason = browserRenderReason(html, staticExtraction, input);
	if (!reason) {
		return staticExtraction;
	}

	return renderHtmlWithBrowser(input, finalUrl, reason, staticExtraction);
}
