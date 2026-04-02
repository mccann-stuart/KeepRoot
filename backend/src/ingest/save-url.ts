import { Readability } from '@mozilla/readability';
import { DOMParser } from 'linkedom';
import TurndownService from 'turndown';
import { saveItemContent } from '../storage/items';
import { validateSafeUrl, type AuthenticatedUser, type BookmarkPayload, type StorageEnv } from '../storage/shared';

interface ExtractedContent {
	htmlData?: string;
	lang?: string | null;
	markdownData: string;
	siteName?: string | null;
	textContent: string;
	title: string;
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function buildExcerptMarkdown(text: string): string {
	const normalized = normalizeWhitespace(text);
	return normalized || '_No extractable text was found._';
}

function titleFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.hostname;
	} catch {
		return 'Untitled';
	}
}

async function extractHtmlContent(url: string, html: string): Promise<ExtractedContent> {
	const document = new DOMParser().parseFromString(html, 'text/html');
	const reader = new Readability(document);
	const article = reader.parse();
	const title = normalizeWhitespace(article?.title ?? document.querySelector('title')?.textContent ?? '') || titleFromUrl(url);
	const siteName = normalizeWhitespace(
		document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')
			?? document.querySelector('meta[name="application-name"]')?.getAttribute('content')
			?? document.querySelector('meta[name="publisher"]')?.getAttribute('content')
			?? '',
	) || null;
	const lang = document.documentElement.getAttribute('lang');

	if (!article?.content) {
		const textContent = normalizeWhitespace(document.documentElement.textContent ?? '');
		return {
			htmlData: html,
			lang,
			markdownData: buildExcerptMarkdown(textContent),
			siteName,
			textContent,
			title,
		};
	}

	const turndown = new TurndownService({
		codeBlockStyle: 'fenced',
		headingStyle: 'atx',
	});
	const articleRoot = new DOMParser()
		.parseFromString(`<article>${article.content}</article>`, 'text/html')
		.querySelector('article');
	const markdownData = articleRoot
		? turndown.turndown(articleRoot).trim() || buildExcerptMarkdown(article.textContent ?? '')
		: buildExcerptMarkdown(article.textContent ?? '');
	const textContent = normalizeWhitespace(article.textContent ?? markdownData);

	return {
		htmlData: html,
		lang,
		markdownData,
		siteName,
		textContent,
		title,
	};
}

async function extractPdfContent(url: string, bytes: ArrayBuffer, responseTitle?: string | null): Promise<ExtractedContent> {
	const { VerbosityLevel, getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const loadingTask = getDocument({
		data: new Uint8Array(bytes),
		disableFontFace: true,
		isEvalSupported: false,
		isImageDecoderSupported: false,
		isOffscreenCanvasSupported: false,
		useWorkerFetch: false,
		verbosity: VerbosityLevel.ERRORS,
	});

	try {
		const document = await loadingTask.promise;
		const pages: string[] = [];

		for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
			const page = await document.getPage(pageNumber);
			try {
				const textContent = await page.getTextContent();
				const pageText = normalizeWhitespace(
					(textContent.items ?? [])
						.map((item) => ('str' in item ? String(item.str ?? '') : ''))
						.join(' '),
				);
				if (pageText) {
					pages.push(pageText);
				}
			} finally {
				page.cleanup();
			}
		}

		const textContent = pages.join('\n\n').trim();
		const markdownData = textContent
			? pages.length > 1
				? pages.map((page, index) => `## Page ${index + 1}\n\n${page}`).join('\n\n')
				: textContent
			: '_No extractable text was found in this PDF._';

		return {
			lang: null,
			markdownData,
			siteName: null,
			textContent,
			title: responseTitle?.trim() || titleFromUrl(url),
		};
	} finally {
		await loadingTask.destroy();
	}
}

async function extractContentFromResponse(url: string, response: Response): Promise<ExtractedContent> {
	const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
	const responseTitle = response.headers.get('content-disposition');

	if (contentType.includes('application/pdf') || url.toLowerCase().endsWith('.pdf')) {
		return extractPdfContent(url, await response.arrayBuffer(), responseTitle);
	}

	if (contentType.startsWith('text/plain')) {
		const textContent = normalizeWhitespace(await response.text());
		return {
			lang: null,
			markdownData: buildExcerptMarkdown(textContent),
			siteName: null,
			textContent,
			title: titleFromUrl(url),
		};
	}

	return extractHtmlContent(url, await response.text());
}

export async function saveItemFromUrl(
	env: StorageEnv,
	user: Pick<AuthenticatedUser, 'userId' | 'username'>,
	input: {
		notes?: string;
		status?: string;
		tags?: string[];
		title?: string;
		url: string;
	},
): Promise<Record<string, unknown>> {
	validateSafeUrl(input.url);
	const response = await fetch(input.url, {
		headers: {
			Accept: 'text/html,application/pdf,text/plain;q=0.9,*/*;q=0.8',
			'User-Agent': 'KeepRoot/1.0 (+https://keeproot.local)',
		},
		redirect: 'manual',
	});

	if (response.status >= 300 && response.status < 400) {
		const location = response.headers.get('location');
		if (location) {
			const nextUrl = new URL(location, input.url).toString();
			return saveItemFromUrl(env, user, { ...input, url: nextUrl });
		}
	}

	if (!response.ok) {
		throw new Error(`Failed to fetch URL (${response.status})`);
	}

	const finalUrl = response.url || input.url;
	const extracted = await extractContentFromResponse(finalUrl, response);
	const payload: BookmarkPayload = {
		htmlData: extracted.htmlData,
		lang: extracted.lang ?? undefined,
		markdownData: extracted.markdownData,
		notes: input.notes,
		siteName: extracted.siteName ?? undefined,
		status: input.status,
		tags: input.tags,
		textContent: extracted.textContent,
		title: input.title?.trim() || extracted.title,
		url: finalUrl,
	};

	return saveItemContent(env, user, payload, 'manual_save');
}
