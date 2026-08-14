import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	BrowserRunCrawlError,
	recogniseBrowserPost,
	runBrowserCrawl,
	type BrowserCrawlRecord,
	type BrowserSourceInput,
	type CrawlStep,
} from '../../src/ingest/browser-run';

function completedPage(html: string, url = 'https://example.com/posts/one'): BrowserCrawlRecord {
	return { html, status: 'completed', url };
}

function source(overrides: Partial<BrowserSourceInput> = {}): BrowserSourceInput {
	return {
		id: 'source-id',
		lastSuccessAt: null,
		name: 'Blog',
		pollUrl: 'https://example.com/blog',
		userId: 'user-id',
		...overrides,
	};
}

interface RecordingEnv {
	binds: unknown[][];
	prepared: string[];
	[key: string]: unknown;
}

/**
 * A D1 stand-in that records the SQL it is handed and answers every shape the crawl uses.
 */
function envWith(overrides: Record<string, unknown> = {}): RecordingEnv {
	const prepared: string[] = [];
	const binds: unknown[][] = [];
	const prepare = vi.fn((sql: string) => {
		prepared.push(sql);
		const statement: Record<string, unknown> = {
			all: vi.fn().mockResolvedValue({ results: [] }),
			bind: vi.fn((...args: unknown[]) => {
				binds.push(args);
				return statement;
			}),
			first: vi.fn().mockResolvedValue({ count: 0 }),
			run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
		};
		return statement;
	});
	return {
		BROWSER_RUN_ACCOUNT_ID: 'account-id',
		BROWSER_RUN_API_TOKEN: 'secret-token',
		KEEPROOT_DB: { batch: vi.fn().mockResolvedValue([]), prepare },
		binds,
		prepared,
		...overrides,
	};
}

/**
 * Drives steps inline and advances the clock for each sleep, which is what lets a two-hour
 * poll deadline be exercised without a two-hour test.
 */
function fakeStep(): CrawlStep & { sleeps: Array<{ duration: unknown; name: string }> } {
	const sleeps: Array<{ duration: unknown; name: string }> = [];
	vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ['Date'] });
	return {
		async do<T>(_name: string, callback: () => Promise<T>): Promise<T> {
			return callback();
		},
		sleeps,
		async sleep(name: string, duration: number | string): Promise<void> {
			sleeps.push({ duration, name });
			const seconds = typeof duration === 'number' ? duration / 1_000 : Number.parseInt(String(duration), 10);
			vi.setSystemTime(new Date(Date.now() + seconds * 1_000));
		},
	};
}

function crawlBody(result: Record<string, unknown>): Record<string, unknown> {
	return {
		result: {
			browserSecondsUsed: 3.55,
			cursor: null,
			id: 'crawl-id',
			records: [],
			...result,
		},
		success: true,
	};
}

/**
 * Routes the crawl API: POST returns a job id, GETs are split into status polls and result
 * pages. Sitemap and robots fetches fall through to 404 so they never count as crawl calls.
 */
function mockCrawlApi(handlers: {
	results?: (call: number) => Record<string, unknown>;
	status: (call: number) => Record<string, unknown>;
}) {
	const calls = { results: 0, status: 0 };
	const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any) => {
		const url = String(input);
		if (!url.includes('/browser-rendering/crawl')) return new Response('Not found', { status: 404 });
		if (init?.method === 'POST') return Response.json({ result: 'crawl-id', success: true });
		if (init?.method === 'DELETE') return Response.json({ result: {}, success: true });
		if (url.includes('status=completed')) {
			calls.results += 1;
			return Response.json(crawlBody(handlers.results?.(calls.results) ?? { records: [] }));
		}
		calls.status += 1;
		return Response.json(crawlBody(handlers.status(calls.status)));
	});
	return { calls, spy };
}

describe('Browser Run post recognition', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});
	it('recognises BlogPosting JSON-LD metadata', async () => {
		const post = await recogniseBrowserPost('https://example.com/blog', completedPage(`
			<html><head>
				<link rel="canonical" href="https://example.com/posts/one">
				<script type="application/ld+json">{
					"@context":"https://schema.org",
					"@type":"BlogPosting",
					"headline":"First post",
					"datePublished":"2026-08-12T09:30:00Z"
				}</script>
			</head></html>
		`));

		expect(post).toEqual({
			canonicalUrl: 'https://example.com/posts/one',
			publishedAt: '2026-08-12T09:30:00.000Z',
			title: 'First post',
		});
	});

	it('recognises Open Graph article metadata', async () => {
		const post = await recogniseBrowserPost('https://example.com/', completedPage(`
			<html><head>
				<link rel="canonical" href="/posts/two">
				<meta property="og:type" content="article">
				<meta property="og:title" content="Second post">
				<meta property="article:published_time" content="2026-08-11">
			</head></html>
		`, 'https://example.com/posts/two'));

		expect(post).toMatchObject({
			canonicalUrl: 'https://example.com/posts/two',
			title: 'Second post',
		});
	});

	it('recognises a single page-level article with a dated time element', async () => {
		const post = await recogniseBrowserPost('https://example.com/blog', completedPage(`
			<html><head><link rel="canonical" href="/posts/three"></head><body>
				<article><h1>Third post</h1><time datetime="2026-08-10T08:00:00Z">10 August</time></article>
			</body></html>
		`, 'https://example.com/posts/three'));

		expect(post).toEqual({
			canonicalUrl: 'https://example.com/posts/three',
			publishedAt: '2026-08-10T08:00:00.000Z',
			title: 'Third post',
		});
	});

	it('recognises a source URL that is itself a Squarespace article', async () => {
		const post = await recogniseBrowserPost('https://insideorchard.com/essays/wall-street-is-predicting-a-turn-in-ai-capex', completedPage(`
			<html><head>
				<link rel="canonical" href="https://insideorchard.com/essays/wall-street-is-predicting-a-turn-in-ai-capex">
				<script type="application/ld+json">{"@type":"WebSite","url":"https://insideorchard.com"}</script>
				<script type="application/ld+json">{
					"@type":"Article",
					"headline":"Wall Street Is Predicting a Turn in AI Capex",
					"datePublished":"2026-08-10T18:09:23-0400"
				}</script>
			</head><body><article>Primary</article><article>Related</article></body></html>
		`, 'https://insideorchard.com/essays/wall-street-is-predicting-a-turn-in-ai-capex'));

		expect(post).toEqual({
			canonicalUrl: 'https://insideorchard.com/essays/wall-street-is-predicting-a-turn-in-ai-capex',
			publishedAt: '2026-08-10T22:09:23.000Z',
			title: 'Wall Street Is Predicting a Turn in AI Capex',
		});
	});

	it.each([
		['home page', '<html><head><meta property="og:type" content="article"><meta property="og:title" content="Blog home"><meta property="article:published_time" content="2026-08-11"></head></html>', 'https://example.com/'],
		['category page', `<html><head><link rel="canonical" href="/category/news"><script type="application/ld+json">${JSON.stringify([
			{ '@type': 'BlogPosting', datePublished: '2026-08-11', headline: 'One', url: '/posts/one' },
			{ '@type': 'BlogPosting', datePublished: '2026-08-10', headline: 'Two', url: '/posts/two' },
		])}</script></head></html>`, 'https://example.com/category/news'],
		['author page', '<html><head><link rel="canonical" href="/author/ada"><meta property="og:type" content="article"><meta property="og:title" content="Posts by Ada"><meta property="article:published_time" content="2026-08-11"></head></html>', 'https://example.com/author/ada'],
		['undated article', '<html><body><article><h1>Undated</h1></article></body></html>', 'https://example.com/posts/undated'],
	])('rejects a %s without recognised article metadata', async (_label, html, url) => {
		await expect(recogniseBrowserPost('https://example.com/blog', completedPage(html, url))).resolves.toBeNull();
	});

	it('rejects a cross-origin canonical URL', async () => {
		await expect(recogniseBrowserPost('https://example.com/blog', completedPage(`
			<html><head>
				<link rel="canonical" href="https://other.example/posts/stolen">
				<meta property="og:type" content="article">
				<meta property="og:title" content="Wrong origin">
				<meta property="article:published_time" content="2026-08-11">
			</head></html>
		`))).resolves.toBeNull();
	});

	it('rejects failed crawl records', async () => {
		await expect(recogniseBrowserPost('https://example.com/blog', {
			status: 'errored',
			url: 'https://example.com/posts/one',
		})).resolves.toBeNull();
	});

	it.each([
		[401, false, null],
		[403, false, null],
		[429, true, 75],
		[503, true, null],
	])('classifies Browser Run HTTP %i responses for retry', async (status, retryable, retryAfterSeconds) => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
			errors: [{ message: 'Upstream rejected request' }],
			success: false,
		}, {
			headers: status === 429 ? { 'Retry-After': '75' } : undefined,
			status,
		}));

		const crawl = runBrowserCrawl(
			envWith({ BROWSER_RUN_API_TOKEN: 'secret-token' }),
			source(),
			'run-id',
			fakeStep(),
		);

		const error = await crawl.catch((caught) => caught);
		expect(error).toBeInstanceOf(BrowserRunCrawlError);
		expect(error).toMatchObject({ retryAfterSeconds, retryable, statusCode: status });
		expect(error.message).not.toContain('secret-token');
	});

	it('reads the API token from a Secrets Store binding', async () => {
		const get = vi.fn().mockResolvedValue('secret-token');
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
			errors: [{ message: 'Upstream rejected request' }],
			success: false,
		}, { status: 401 }));

		await expect(runBrowserCrawl(
			envWith({ BROWSER_RUN_API_TOKEN: { get } }),
			source(),
			'run-id',
			fakeStep(),
		)).rejects.toMatchObject({ statusCode: 401 });

		expect(get).toHaveBeenCalledOnce();
		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining('/browser-rendering/crawl'),
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
			}),
		);
	});

	it('backs off between polls and persists upstream progress', async () => {
		const env = envWith();
		mockCrawlApi({ status: () => ({ finished: 2, status: 'running', total: 5 }) });
		const step = fakeStep();

		// The run ends at the deadline; the assertion is on cadence, not on completion.
		await runBrowserCrawl(env, source(), 'run-id', step).catch(() => undefined);

		expect(step.sleeps.slice(0, 3).map((entry) => entry.duration))
			.toEqual(['5 seconds', '10 seconds', '20 seconds']);
		expect(env.prepared.some((sql) => sql.includes('upstream_finished_count = ?'))).toBe(true);
		expect(env.binds.some((args) => args[0] === 2 && args[1] === 5 && args[2] === 3.55)).toBe(true);
	});

	it('cancels and fails an upstream crawl after KeepRoot\'s two-hour timeout', async () => {
		const { spy } = mockCrawlApi({ status: () => ({ finished: 2, status: 'running', total: 5 }) });

		const error = await runBrowserCrawl(envWith(), source(), 'run-id', fakeStep())
			.catch((caught) => caught);

		expect(error).toMatchObject({
			message: 'Browser Run crawl exceeded the 2 hour KeepRoot timeout',
			retryable: false,
		});
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining('/browser-rendering/crawl/crawl-id'),
			expect.objectContaining({ method: 'DELETE' }),
		);
	});

	// Production run d37763ce polled for over an hour against a job reporting finished:1 of
	// total:1 that never left "running". Counters that have settled must end the wait.
	it('stops polling a job whose pages have all finished but stays running', async () => {
		const { calls } = mockCrawlApi({
			results: () => ({
				finished: 1,
				records: [{ status: 'completed', url: 'https://example.com/posts/one' }],
				status: 'running',
				total: 1,
			}),
			status: () => ({ finished: 1, records: [], status: 'running', total: 1 }),
		});

		await runBrowserCrawl(envWith(), source(), 'run-id', fakeStep()).catch(() => undefined);

		// Three stable polls end the wait; the old fixed-cadence loop reached hundreds.
		expect(calls.status).toBe(3);
	});

	// Production run 9b46d99d fetched 944 result pages for a 13-record crawl. Browser Run
	// answers an out-of-range cursor with records rather than an empty page, so a loop that
	// trusts the cursor alone never terminates.
	it('bounds result paging when the cursor never terminates', async () => {
		const { calls } = mockCrawlApi({
			results: (call) => ({
				cursor: String(call * 25),
				finished: 13,
				// Always non-empty and always advancing: only an explicit bound stops this.
				records: Array.from({ length: 25 }, (_, index) => ({
					status: 'queued',
					url: `https://example.com/posts/${call}-${index}`,
				})),
				status: 'completed',
				total: 13,
			}),
			status: () => ({ finished: 13, records: [], status: 'completed', total: 13 }),
		});

		await runBrowserCrawl(envWith(), source(), 'run-id', fakeStep()).catch(() => undefined);

		expect(calls.results).toBeGreaterThan(0);
		expect(calls.results).toBeLessThanOrEqual(4);
	});

	it('stops paging when the cursor repeats', async () => {
		const { calls } = mockCrawlApi({
			results: (call) => ({
				cursor: '25',
				finished: 60,
				records: [{ status: 'queued', url: `https://example.com/posts/${call}` }],
				status: 'completed',
				total: 60,
			}),
			status: () => ({ finished: 60, records: [], status: 'completed', total: 60 }),
		});

		await runBrowserCrawl(envWith(), source(), 'run-id', fakeStep()).catch(() => undefined);

		expect(calls.results).toBe(2);
	});

	// The Verge's crawl is scoped by includePatterns, so Browser Run reports the other 6,702
	// sitemap URLs as `skipped` frontier entries alongside the one page it fetched. Counting
	// those as failures marked healthy runs "partial" and inflated skipped_count.
	it('does not count unattempted frontier records as examined pages or errors', async () => {
		const env = envWith();
		mockCrawlApi({
			results: () => ({
				finished: 1,
				records: [
					{
						html: `<html><head><link rel="canonical" href="https://example.com/posts/one">
							<meta property="og:type" content="article">
							<meta property="og:title" content="Only post">
							<meta property="article:published_time" content="2026-08-14">
						</head></html>`,
						status: 'completed',
						url: 'https://example.com/posts/one',
					},
					...Array.from({ length: 24 }, (_, index) => ({
						status: 'skipped',
						url: `https://example.com/frontier/${index}`,
					})),
				],
				status: 'completed',
				total: 1,
			}),
			status: () => ({ finished: 1, records: [], status: 'completed', total: 1 }),
		});

		await runBrowserCrawl(env, source(), 'run-id', fakeStep()).catch(() => undefined);

		const ingest = env.prepared.findIndex((sql) => sql.includes('examined_count = examined_count + ?'));
		expect(ingest).toBeGreaterThanOrEqual(0);
		// (examined, processed, staged, unchanged, skipped, upstreamErrors, ...)
		const counts = env.binds.find((args) => args.length === 8 && args[6] === 'run-id');
		expect(counts?.slice(0, 6)).toEqual([1, 1, 1, 0, 0, 0]);
	});
});
