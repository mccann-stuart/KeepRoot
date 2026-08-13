import { Readability } from '@mozilla/readability';
import { DOMParser } from 'linkedom';
import TurndownService from 'turndown';
import { renderPageWithBrowser, type BrowserRenderReason } from './browser';
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
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function createTurndownService(): TurndownService {
	return new TurndownService({
		codeBlockStyle: 'fenced',
		headingStyle: 'atx',
	});
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
		const turndownService = createTurndownService();
		const titleNodeText = document.querySelector('title')?.textContent?.trim() ?? '';
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
		const article = readability.parse();
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

		return {
			htmlData: html,
			lang,
			markdownData,
			readabilitySucceeded: Boolean(article?.content?.trim()),
			siteName,
			textContent,
			title: article?.title?.trim() || fallbackTitle?.trim() || titleNodeText || 'Untitled',
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
