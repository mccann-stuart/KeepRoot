import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	advanceBrowserSourceRun,
	BrowserRunCrawlError,
	recogniseBrowserPost,
	type BrowserCrawlRecord,
} from '../../src/ingest/browser-run';

function completedPage(html: string, url = 'https://example.com/posts/one'): BrowserCrawlRecord {
	return { html, status: 'completed', url };
}

describe('Browser Run post recognition', () => {
	afterEach(() => vi.restoreAllMocks());
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
	])('classifies Browser Run HTTP %i responses for queue retry', async (status, retryable, retryAfterSeconds) => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
			errors: [{ message: 'Upstream rejected request' }],
			success: false,
		}, {
			headers: status === 429 ? { 'Retry-After': '75' } : undefined,
			status,
		}));
		const statement = {
			bind: vi.fn().mockReturnThis(),
			first: vi.fn().mockResolvedValue({ count: 0 }),
		};
		const crawl = advanceBrowserSourceRun({
			BROWSER_RUN_ACCOUNT_ID: 'account-id',
			BROWSER_RUN_API_TOKEN: 'secret-token',
			KEEPROOT_DB: { prepare: vi.fn().mockReturnValue(statement) },
		} as any, {
			id: 'source-id',
			lastSuccessAt: null,
			name: 'Blog',
			pollUrl: 'https://example.com/blog',
			userId: 'user-id',
		}, {
			initialCrawl: false,
			runId: 'run-id',
			upstreamCursor: null,
			upstreamJobId: null,
			upstreamPhase: null,
			upstreamStartedAt: null,
		});

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
		const statement = {
			bind: vi.fn().mockReturnThis(),
			first: vi.fn().mockResolvedValue({ count: 0 }),
		};

		await expect(advanceBrowserSourceRun({
			BROWSER_RUN_ACCOUNT_ID: 'account-id',
			BROWSER_RUN_API_TOKEN: { get },
			KEEPROOT_DB: { prepare: vi.fn().mockReturnValue(statement) },
		} as any, {
			id: 'source-id',
			lastSuccessAt: null,
			name: 'Blog',
			pollUrl: 'https://example.com/blog',
			userId: 'user-id',
		}, {
			initialCrawl: false,
			runId: 'run-id',
			upstreamCursor: null,
			upstreamJobId: null,
			upstreamPhase: null,
			upstreamStartedAt: null,
		})).rejects.toMatchObject({ statusCode: 401 });

		expect(get).toHaveBeenCalledOnce();
		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining('/browser-rendering/crawl'),
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
			}),
		);
	});

	it('cancels and fails an upstream crawl after KeepRoot\'s 30-minute timeout', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true, result: {} }));
		const crawl = advanceBrowserSourceRun({
			BROWSER_RUN_ACCOUNT_ID: 'account-id',
			BROWSER_RUN_API_TOKEN: 'secret-token',
			KEEPROOT_DB: {},
		} as any, {
			id: 'source-id',
			lastSuccessAt: null,
			name: 'Blog',
			pollUrl: 'https://example.com/blog',
			userId: 'user-id',
		}, {
			initialCrawl: true,
			runId: 'run-id',
			upstreamCursor: null,
			upstreamJobId: 'crawl-id',
			upstreamPhase: 'waiting',
			upstreamStartedAt: new Date(Date.now() - 31 * 60 * 1_000).toISOString(),
		});

		const error = await crawl.catch((caught) => caught);
		expect(error).toMatchObject({
			message: 'Browser Run crawl exceeded the 30 minute KeepRoot timeout',
			retryable: false,
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining('/browser-rendering/crawl/crawl-id'),
			expect.objectContaining({ method: 'DELETE' }),
		);
	});
});
