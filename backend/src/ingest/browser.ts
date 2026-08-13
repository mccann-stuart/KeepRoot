import { validateSafeUrl } from '../storage/shared';

export type BrowserRenderReason = 'explicit' | 'js_shell' | 'low_content' | 'screenshot';

export interface RenderedPage {
	browserMsUsed?: number;
	engine: 'chromium' | 'kitesurf';
	html: string;
	screenshotBase64?: string;
}

interface RenderPageInput {
	accountId?: string;
	apiToken?: string;
	browser?: BrowserRun;
	captureScreenshot?: boolean;
	engine?: string;
	fetchImpl?: typeof fetch;
	url: string;
}

const MAX_BROWSER_ERROR_LENGTH = 400;
const CLOUDFLARE_ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;

function browserMilliseconds(response: Response): number | undefined {
	const rawValue = response.headers.get('x-browser-ms-used');
	if (!rawValue) {
		return undefined;
	}

	const value = Number.parseInt(rawValue, 10);
	return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeScreenshotBase64(value: string): string {
	const trimmed = value.trim();
	const dataUriPrefix = /^data:image\/[a-z0-9.+-]+;base64,/i.exec(trimmed);
	return dataUriPrefix ? trimmed.slice(dataUriPrefix[0].length) : trimmed;
}

async function browserRunError(response: Response): Promise<string> {
	try {
		const payload = await response.json() as BrowserRunErrorResponse;
		const message = payload.errors?.map((error) => error.message).filter(Boolean).join('; ');
		if (message) {
			return message.slice(0, MAX_BROWSER_ERROR_LENGTH);
		}
	} catch {
		// Browser Run can return a non-JSON platform error. The status remains useful.
	}

	return `HTTP ${response.status}`;
}

export async function renderPageWithBrowser(input: RenderPageInput): Promise<RenderedPage> {
	// The static fetch path has already checked every redirect. Revalidate the final
	// URL immediately before handing it to the isolated browser capability.
	if (!await validateSafeUrl(input.url)) {
		throw new Error('Unsafe browser render URL');
	}

	const commonOptions = {
		actionTimeout: 30_000,
		bestAttempt: true,
		cacheTTL: 5,
		gotoOptions: {
			timeout: 20_000,
			waitUntil: 'domcontentloaded' as const,
		},
		url: input.url,
		viewport: {
			height: 900,
			width: 1440,
		},
		waitForTimeout: 750,
	};

	const action = input.captureScreenshot ? 'snapshot' : 'content';
	const options = input.captureScreenshot
		? {
			...commonOptions,
			screenshotOptions: {
				fullPage: false,
				type: 'png' as const,
			},
		}
		: {
			...commonOptions,
			rejectResourceTypes: ['font', 'media'] as BrowserRunResourceType[],
		};

	const requestedEngine = input.engine?.trim().toLowerCase();
	if (requestedEngine && requestedEngine !== 'chromium' && requestedEngine !== 'kitesurf') {
		throw new Error(`Unsupported Browser Run engine "${requestedEngine}"`);
	}

	let engine: RenderedPage['engine'];
	let response: Response;
	if (requestedEngine === 'kitesurf') {
		if (!input.accountId || !CLOUDFLARE_ACCOUNT_ID_PATTERN.test(input.accountId) || !input.apiToken) {
			throw new Error('Kitesurf requires a valid BROWSER_RUN_ACCOUNT_ID and BROWSER_RUN_API_TOKEN');
		}

		engine = 'kitesurf';
		const endpoint = `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/browser-rendering/${action}?browser=kitesurf`;
		response = await (input.fetchImpl ?? fetch)(endpoint, {
			body: JSON.stringify(options),
			headers: {
				Authorization: `Bearer ${input.apiToken}`,
				'Content-Type': 'application/json',
			},
			method: 'POST',
		});
	} else {
		if (!input.browser) {
			throw new Error('Browser Run binding is unavailable');
		}

		engine = 'chromium';
		response = input.captureScreenshot
			? await input.browser.quickAction('snapshot', options as BrowserRunSnapshotOptions)
			: await input.browser.quickAction('content', options as BrowserRunContentOptions);
	}

	if (!response.ok) {
		throw new Error(`Browser Run ${input.captureScreenshot ? 'snapshot' : 'content'} failed: ${await browserRunError(response)}`);
	}

	const browserMsUsed = browserMilliseconds(response);
	if (input.captureScreenshot) {
		const payload = await response.json() as BrowserRunSnapshotSuccessResponse;
		if (!payload.success || !payload.result?.content || !payload.result.screenshot) {
			throw new Error('Browser Run snapshot returned incomplete rendered content');
		}
		if (payload.meta?.status >= 400) {
			throw new Error(`Browser Run page returned HTTP ${payload.meta.status}`);
		}

		const screenshotBase64 = normalizeScreenshotBase64(payload.result.screenshot);
		if (!screenshotBase64) {
			throw new Error('Browser Run snapshot returned an empty screenshot');
		}

		return {
			browserMsUsed,
			engine,
			html: payload.result.content,
			screenshotBase64,
		};
	}

	const payload = await response.json() as BrowserRunContentSuccessResponse;
	if (!payload.success || !payload.result) {
		throw new Error('Browser Run content action returned no rendered HTML');
	}
	if (payload.meta?.status >= 400) {
		throw new Error(`Browser Run page returned HTTP ${payload.meta.status}`);
	}

	return {
		browserMsUsed,
		engine,
		html: payload.result,
	};
}
