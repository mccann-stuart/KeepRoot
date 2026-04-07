import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { validateSafeUrl } from '../storage/shared';

interface ExtractedBookmarkPayload {
	htmlData?: string;
	lang?: string | null;
	markdownData: string;
	textContent: string;
	title: string;
	url: string;
}

interface ExtractBookmarkPayloadInput {
	fallbackTitle?: string;
	fetchImpl?: typeof fetch;
	url: string;
}

const PDF_VIEWER_PARAM_KEYS = ['src', 'file', 'url'];
const PDF_CONTENT_TYPES = new Set(['application/pdf']);
const NO_EXTRACTABLE_TEXT_MARKDOWN = '_No extractable text was found in this PDF. OCR is not currently supported._';

function normalizePdfText(rawText: string): string {
	return String(rawText ?? '')
		.replace(/\u0000/g, '')
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();
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
		isEvalSupported: false,
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

		const pages: Array<{ pageNumber: number; text: string }> = [];
		for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
			const page = await document.getPage(pageNumber);
			try {
				const textContent = await page.getTextContent();
				const pageText = extractTextFromPdfItems((textContent.items ?? []) as Array<{ hasEOL?: boolean; str?: string }>);
				if (pageText) {
					pages.push({ pageNumber, text: pageText });
				}
			} finally {
				page.cleanup();
			}
		}

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

function fallbackExtractHtmlBookmark(html: string, url: string, fallbackTitle?: string): ExtractedBookmarkPayload {
	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const headingMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
	const textContent = htmlToPlainText(html);
	const title = normalizePdfText(headingMatch?.[1] ?? titleMatch?.[1] ?? fallbackTitle ?? 'Untitled') || 'Untitled';
	const markdownData = textContent || title;

	return {
		htmlData: html,
		lang: null,
		markdownData,
		textContent: markdownData,
		title,
		url,
	};
}

function extractHtmlBookmark(html: string, url: string, fallbackTitle?: string): ExtractedBookmarkPayload {
	try {
		const { document } = parseHTML(html);
		let article: ReturnType<Readability['parse']> | null = null;
		const readability = new Readability(document as never);
		article = readability.parse();
		const turndownService = createTurndownService();
		const titleNodeText = document.querySelector('title')?.textContent?.trim() ?? '';
		const articleHtml = article?.content?.trim() || document.body?.innerHTML?.trim() || html;
		const markdownData = turndownService.turndown(articleHtml).trim() || htmlToPlainText(articleHtml);
		const textContent = normalizePdfText(
			article?.textContent?.trim()
				|| htmlToPlainText(articleHtml)
				|| markdownData,
		);

		return {
			htmlData: html,
			lang: document.documentElement?.getAttribute('lang'),
			markdownData,
			textContent,
			title: article?.title?.trim() || fallbackTitle?.trim() || titleNodeText || 'Untitled',
			url,
		};
	} catch {
		return fallbackExtractHtmlBookmark(html, url, fallbackTitle);
	}
}

export async function extractBookmarkPayloadFromUrl(input: ExtractBookmarkPayloadInput): Promise<ExtractedBookmarkPayload> {
	if (!await validateSafeUrl(input.url)) {
		throw new Error('Unsafe initial URL');
	}

	let currentUrl = input.url;
	let response: Response | null = null;
	let redirectCount = 0;

	while (redirectCount < 5) {
		response = await (input.fetchImpl ?? fetch)(currentUrl, {
			headers: {
				Accept: 'text/html,application/pdf,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			},
			redirect: 'manual',
		});

		if ([301, 302, 303, 307, 308].includes(response.status)) {
			await response.body?.cancel().catch(() => {});
			const location = response.headers.get('location');
			if (!location) {
				throw new Error('Redirect missing location header');
			}
			const nextUrl = new URL(location, currentUrl).toString();
			if (!await validateSafeUrl(nextUrl)) {
				throw new Error('Unsafe redirect URL');
			}
			currentUrl = nextUrl;
			redirectCount += 1;
			continue;
		}
		break;
	}

	if (!response || !response.ok) {
		throw new Error(`Failed to fetch URL (${response?.status ?? 'Unknown'})`);
	}

	const finalUrl = resolvePdfSourceUrl(response.url || currentUrl);
	const contentType = normalizeContentType(response.headers.get('content-type'));
	if (PDF_CONTENT_TYPES.has(contentType) || (contentType === 'application/octet-stream' && isLikelyPdfUrl(finalUrl)) || isLikelyPdfUrl(finalUrl)) {
		const pdfBytes = new Uint8Array(await response.arrayBuffer());
		return extractPdfBookmark(finalUrl, pdfBytes, input.fallbackTitle);
	}

	const html = await response.text();
	return extractHtmlBookmark(html, finalUrl, input.fallbackTitle);
}
