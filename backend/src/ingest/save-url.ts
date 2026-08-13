import { extractBookmarkPayloadFromUrl } from './extract-url';
import { saveItemContent } from '../storage/items';
import type { AuthenticatedUser, BookmarkPayload, StorageEnv } from '../storage/shared';

export async function saveItemFromUrl(
	env: StorageEnv,
	user: Pick<AuthenticatedUser, 'userId' | 'username'>,
	input: {
		captureScreenshot?: boolean;
		notes?: string;
		render?: boolean;
		status?: string;
		tags?: string[];
		title?: string;
		url: string;
	},
): Promise<Record<string, unknown>> {
	const extracted = await extractBookmarkPayloadFromUrl({
		browser: env.BROWSER,
		browserRunAccountId: env.BROWSER_RUN_ACCOUNT_ID,
		browserRunApiToken: env.BROWSER_RUN_API_TOKEN,
		browserRunEngine: env.BROWSER_RUN_ENGINE,
		captureScreenshot: input.captureScreenshot,
		fallbackTitle: input.title,
		render: input.render,
		url: input.url,
	});
	const payload: BookmarkPayload = {
		htmlData: extracted.htmlData,
		images: extracted.images,
		lang: extracted.lang ?? undefined,
		markdownData: extracted.markdownData,
		notes: input.notes,
		siteName: extracted.siteName ?? undefined,
		status: input.status,
		tags: input.tags,
		textContent: extracted.textContent,
		title: input.title?.trim() || extracted.title,
		url: extracted.url,
	};

	const savedItem = await saveItemContent(env, user, payload, 'manual_save');
	return extracted.browserExtraction
		? { ...savedItem, extraction: extracted.browserExtraction }
		: savedItem;
}
