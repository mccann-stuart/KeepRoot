import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { addSource, createApiKey, createList, createSession, createSmartList, createUserWithCredential, ensureAccountSettings, getBookmark, hashToken, recordToolEvent, saveBookmark, storeAuthChallenge } from '../src/storage';
import { enqueueSourceRun, processSourceQueueJob } from '../src/ingest/source-queue';
import initialSchemaSql from '../migrations/0001_initial.sql?raw';
import organizationSchemaSql from '../migrations/0002_organization.sql?raw';
import mcpServerSchemaSql from '../migrations/0003_mcp_server.sql?raw';
import bookmarkHotPathSchemaSql from '../migrations/0004_bookmark_hot_path.sql?raw';
import securityHardeningSchemaSql from '../migrations/0005_security_hardening.sql?raw';
import sourceEntryIdentitySchemaSql from '../migrations/0006_source_entry_identity.sql?raw';
import queueFirstFeedCrawlingSchemaSql from '../migrations/0007_queue_first_feed_crawling.sql?raw';
import adaptiveFeedSchedulingSchemaSql from '../migrations/0008_adaptive_feed_scheduling.sql?raw';
import browserRunSourcesSchemaSql from '../migrations/0009_browser_run_sources.sql?raw';
import browserSitemapShortlistSchemaSql from '../migrations/0010_browser_sitemap_shortlist.sql?raw';

const API_KEY = 'test-api-key-12345';
const TEST_USER_ID = 'test-user-id';
const TEST_USERNAME = 'testuser';
const LEGACY_MCP_PROTOCOL_VERSION = '2025-11-25';
const MODERN_MCP_PROTOCOL_VERSION = '2026-07-28';
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgQJ8i1QAAAAASUVORK5CYII=';
const verifyRegistrationResponseMock = vi.fn();
const verifyAuthenticationResponseMock = vi.fn();
const generateAuthenticationOptionsMock = vi.fn();
const generateRegistrationOptionsMock = vi.fn();

vi.mock('@simplewebauthn/server', () => ({
	generateAuthenticationOptions: generateAuthenticationOptionsMock,
	generateRegistrationOptions: generateRegistrationOptionsMock,
	verifyAuthenticationResponse: verifyAuthenticationResponseMock,
	verifyRegistrationResponse: verifyRegistrationResponseMock,
}));

function mockImageFetch(responses: Record<string, { bodyBase64?: string; contentType?: string }>) {
	const originalFetch = globalThis.fetch;
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		const match = responses[url];
		if (match) {
			const bytes = Uint8Array.from(atob(match.bodyBase64 ?? TINY_PNG_BASE64), (char) => char.charCodeAt(0));
			return new Response(bytes, {
				headers: {
					'Content-Type': match.contentType ?? 'image/png',
				},
			});
		}

		return originalFetch(input, init);
	});
}

function mockTextFetch(responses: Record<string, { body: string; contentType?: string; status?: number }>) {
	const originalFetch = globalThis.fetch;
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		const match = responses[url];
		if (match) {
			return new Response(match.body, {
				headers: {
					'Content-Type': match.contentType ?? 'text/plain; charset=utf-8',
				},
				status: match.status ?? 200,
			});
		}

		return originalFetch(input, init);
	});
}

function envWithAllowedExtensionIds(...ids: string[]): typeof env & { ALLOWED_EXTENSION_IDS: string } {
	return {
		...env,
		ALLOWED_EXTENSION_IDS: JSON.stringify(ids),
	};
}

function envWithRegistrationEnabled(baseEnv: typeof env = env): Omit<typeof env, 'ALLOW_REGISTRATION'> & { ALLOW_REGISTRATION: string } {
	return {
		...baseEnv,
		ALLOW_REGISTRATION: '1',
	};
}

function envWithRegistrationDisabled(): Omit<typeof env, 'ALLOW_REGISTRATION'> & { ALLOW_REGISTRATION: string } {
	return {
		...env,
		ALLOW_REGISTRATION: '0',
	};
}

async function execStatements(sql: string, allowExisting = false): Promise<void> {
	const statements = sql
		.split(/;\s*\n/g)
		.map((statement) => statement.trim())
		.filter(Boolean);

	for (const statement of statements) {
		try {
			await env.KEEPROOT_DB.exec(statement.replace(/\s+/g, ' ').trim());
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (allowExisting && /duplicate column name|already exists/i.test(message)) {
				continue;
			}
			throw error;
		}
	}
}

async function tryExec(sql: string): Promise<void> {
	try {
		await env.KEEPROOT_DB.exec(sql.replace(/\s+/g, ' ').trim());
	} catch {
		// Ignore cleanup for optional tables in reset paths.
	}
}

async function resetDatabase(): Promise<void> {
	await execStatements(initialSchemaSql, true);
	await execStatements(organizationSchemaSql, true);
	await execStatements(mcpServerSchemaSql, true);
	await execStatements(bookmarkHotPathSchemaSql, true);
	await execStatements(securityHardeningSchemaSql, true);
	await execStatements(sourceEntryIdentitySchemaSql, true);
	await execStatements(queueFirstFeedCrawlingSchemaSql, true);
	await execStatements(adaptiveFeedSchedulingSchemaSql, true);
	await execStatements(browserRunSourcesSchemaSql, true);
	await execStatements(browserSitemapShortlistSchemaSql, true);
	await execStatements(`
		DELETE FROM bookmark_tags;
		DELETE FROM bookmark_images;
		DELETE FROM bookmark_contents;
		DELETE FROM bookmarks;
		DELETE FROM tags;
		DELETE FROM api_keys;
		DELETE FROM sessions;
		DELETE FROM auth_challenges;
		DELETE FROM webauthn_credentials;
		DELETE FROM users;
	`);
	await tryExec('DELETE FROM item_search_fts');
	await tryExec('DELETE FROM tool_events');
	await tryExec('DELETE FROM bookmark_embeddings');
	await tryExec('DELETE FROM item_search_documents');
	await tryExec('DELETE FROM inbox_entries');
	await tryExec('DELETE FROM source_discoveries');
	await tryExec('DELETE FROM source_sitemap_urls');
	await tryExec('DELETE FROM source_runs');
	await tryExec('DELETE FROM sources');
	await tryExec('DELETE FROM account_settings');
	await tryExec('DELETE FROM smart_lists');
	await tryExec('DELETE FROM lists');
}

async function clearBucket(): Promise<void> {
	let listResult = await env.KEEPROOT_CONTENT.list();
	while (listResult.objects.length > 0) {
		await Promise.all(listResult.objects.map((object) => env.KEEPROOT_CONTENT.delete(object.key)));
		if (!listResult.truncated) {
			return;
		}
		listResult = await env.KEEPROOT_CONTENT.list({ cursor: listResult.cursor });
	}
}

async function seedApiKey(): Promise<void> {
	const createdAt = new Date().toISOString();
	await env.KEEPROOT_DB.prepare(
		'INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)',
	)
		.bind(TEST_USER_ID, TEST_USERNAME, createdAt)
		.run();

	await env.KEEPROOT_DB.prepare(
		`INSERT INTO api_keys (id, secret_hash, user_id, username, name, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			'test-api-key-id',
			await hashToken(API_KEY),
			TEST_USER_ID,
			TEST_USERNAME,
			'Test Key',
			createdAt,
			new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
		)
		.run();
}

async function seedUser(userId: string, username: string): Promise<void> {
	await env.KEEPROOT_DB.prepare(
		'INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)',
	)
		.bind(userId, username, new Date().toISOString())
		.run();
}

async function authedRequest(
	path: string,
	options: {
		body?: unknown;
		method?: string;
		token: string;
	} = { token: API_KEY },
): Promise<Response> {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request(`http://example.com${path}`, {
		method: options.method ?? 'GET',
		headers: {
			Authorization: `Bearer ${options.token}`,
			...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	}), env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

async function rawMcpRequest(
	message: Record<string, unknown>,
	headers: Record<string, string> = {},
): Promise<Response> {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request('http://example.com/mcp', {
		method: 'POST',
		headers: {
			Accept: 'application/json, text/event-stream',
			Authorization: `Bearer ${API_KEY}`,
			'Content-Type': 'application/json',
			...headers,
		},
		body: JSON.stringify(message),
	}), env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

async function parseMcpResponse(response: Response): Promise<any> {
	const body = await response.text();
	if (response.headers.get('Content-Type')?.includes('application/json')) {
		return JSON.parse(body);
	}

	const messages = body
		.split(/\r?\n/)
		.filter((line) => line.startsWith('data:'))
		.map((line) => JSON.parse(line.slice(5).trim()));
	if (messages.length === 0) {
		throw new Error(`MCP response did not contain a JSON or SSE message: ${body}`);
	}
	return messages.at(-1);
}

async function mcpRequest(method: string, params: Record<string, unknown> = {}): Promise<{ data: any; response: Response }> {
	const response = await rawMcpRequest({
		id: crypto.randomUUID(),
		jsonrpc: '2.0',
		method,
		params,
	});
	const data = await parseMcpResponse(response);
	return { data, response };
}

async function modernMcpRequest(
	method: string,
	params: Record<string, unknown> = {},
	headers: Record<string, string> = {},
): Promise<{ data: any; response: Response }> {
	const response = await rawMcpRequest({
		id: crypto.randomUUID(),
		jsonrpc: '2.0',
		method,
		params: {
			...params,
			_meta: {
				'io.modelcontextprotocol/clientCapabilities': {},
				'io.modelcontextprotocol/clientInfo': {
					name: 'keeproot-worker-test',
					version: '1.0.0',
				},
				'io.modelcontextprotocol/protocolVersion': MODERN_MCP_PROTOCOL_VERSION,
			},
		},
	}, {
		'MCP-Protocol-Version': MODERN_MCP_PROTOCOL_VERSION,
		'Mcp-Method': method,
		...headers,
	});
	const data = await parseMcpResponse(response);
	return { data, response };
}

function extractToolPayload(result: any): any {
	if (result?.structuredContent && typeof result.structuredContent === 'object') {
		return result.structuredContent;
	}

	const textBlock = Array.isArray(result?.content)
		? result.content.find((entry: { text?: string; type?: string }) => entry?.type === 'text' && typeof entry.text === 'string')
		: null;
	if (!textBlock?.text) {
		return undefined;
	}

	return JSON.parse(textBlock.text);
}

async function mcpCallTool(name: string, args: Record<string, unknown> = {}): Promise<{ payload: any; result: any }> {
	const { data, response } = await mcpRequest('tools/call', {
		arguments: args,
		name,
	});
	expect(response.status).toBe(200);
	expect(data.error).toBeUndefined();
	if (data.result?.isError) {
		const message = Array.isArray(data.result.content)
			? data.result.content.find((entry: { text?: string; type?: string }) => entry?.type === 'text' && typeof entry.text === 'string')?.text
			: undefined;
		throw new Error(`MCP tool ${name} failed: ${message ?? 'Unknown tool error'}`);
	}
	return {
		payload: extractToolPayload(data.result),
		result: data.result,
	};
}

describe('KeepRoot Worker', () => {
	beforeEach(async () => {
		vi.restoreAllMocks();
		generateAuthenticationOptionsMock.mockReset();
		generateRegistrationOptionsMock.mockReset();
		verifyRegistrationResponseMock.mockReset();
		verifyAuthenticationResponseMock.mockReset();
		delete (env as { INGEST_QUEUE?: unknown }).INGEST_QUEUE;
		delete (env as { SOURCE_DLQ?: unknown }).SOURCE_DLQ;
		delete (env as { SOURCE_QUEUE?: unknown }).SOURCE_QUEUE;
		delete (env as { MCP_EMAIL_DOMAIN?: string }).MCP_EMAIL_DOMAIN;
		await resetDatabase();
		await clearBucket();
		await seedApiKey();
	});

	it('responds with 401 Unauthorized if no token provided', async () => {
		const request = new Request('http://example.com/bookmarks');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Unauthorized' });
	});

	it('persists and returns a feed article publication timestamp', async () => {
		const publishedAt = '2026-08-06T09:30:00.000Z';
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<rss><channel></channel></rss>'));
		const source = await addSource(env, {
			identifier: 'https://example.com/publication-feed.xml',
			kind: 'rss',
			name: 'Publication feed',
			userId: TEST_USER_ID,
		});
		const saved = await saveBookmark(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		}, {
			markdownData: '# Published article',
			publishedAt,
			sourceEntryId: 'published-entry',
			sourceId: String(source.id),
			title: 'Published article',
			url: 'https://example.com/published-article',
		});

		expect(saved.metadata).toEqual(expect.objectContaining({ publishedAt }));
		const loaded = await getBookmark(env, TEST_USER_ID, saved.id);
		expect(loaded?.metadata).toEqual(expect.objectContaining({ publishedAt }));
		const row = await env.KEEPROOT_DB.prepare(
			'SELECT published_at FROM bookmarks WHERE id = ? AND user_id = ?',
		).bind(saved.id, TEST_USER_ID).first<{ published_at: string | null }>();
		expect(row?.published_at).toBe(publishedAt);
	});

	it('dispatches one minimal queue job per source and deduplicates cron retries', async () => {
		const now = new Date().toISOString();
		await env.KEEPROOT_DB.prepare(
			`INSERT INTO sources
			(id, user_id, kind, name, normalized_identifier, poll_url, status, config_json, created_at, updated_at)
			VALUES (?, ?, 'rss', 'Test feed', ?, ?, 'active', '{}', ?, ?)`,
		).bind('source-cron', TEST_USER_ID, 'https://example.com/feed.xml', 'https://example.com/feed.xml', now, now).run();
		await env.KEEPROOT_DB.prepare(
			`INSERT INTO sources
			(id, user_id, kind, name, normalized_identifier, poll_url, status, config_json, next_poll_at, created_at, updated_at)
			VALUES (?, ?, 'rss', 'Future feed', ?, ?, 'active', '{}', ?, ?, ?)`,
		).bind(
			'source-future',
			TEST_USER_ID,
			'https://example.com/future.xml',
			'https://example.com/future.xml',
			'2026-08-06T13:00:00.000Z',
			now,
			now,
		).run();
		await env.KEEPROOT_DB.prepare(
			`INSERT INTO sources
			(id, user_id, kind, name, normalized_identifier, poll_url, status, config_json,
				active_run_id, lease_expires_at, created_at, updated_at)
			VALUES (?, ?, 'browser', 'Leased browser source', ?, ?, 'active', '{}', ?, ?, ?, ?)`,
		).bind(
			'source-leased',
			TEST_USER_ID,
			'https://example.com/blog',
			'https://example.com/blog',
			'run-active',
			'2026-08-06T12:10:00.000Z',
			now,
			now,
		).run();
		const sendBatch = vi.fn().mockResolvedValue({ metadata: { metrics: { backlogBytes: 1, backlogCount: 1 } } });
		const sourceQueue = { sendBatch } as unknown as Queue<unknown>;
		const scheduledTime = Date.parse('2026-08-06T12:00:00.000Z');
		const queueEnv = { ...env, SOURCE_QUEUE: sourceQueue };

		await worker.scheduled({ scheduledTime } as ScheduledController, queueEnv, createExecutionContext());
		await worker.scheduled({ scheduledTime } as ScheduledController, queueEnv, createExecutionContext());

		expect(sendBatch).toHaveBeenCalledTimes(2);
		const sent = sendBatch.mock.calls[0][0];
		expect(sent).toHaveLength(1);
		expect(sent[0].body).toEqual({ runId: expect.any(String), sourceId: 'source-cron' });
		expect(JSON.stringify(sent[0].body)).not.toContain('example.com');
		expect(sendBatch.mock.calls[1][0][0].body).toEqual(sent[0].body);
	});

	it('uses a sitemap shortlist and imports each newly listed canonical URL once', async () => {
		const send = vi.fn().mockResolvedValue({});
		const browserEnv = {
			...env,
			BROWSER_RUN_ACCOUNT_ID: 'browser-account',
			BROWSER_RUN_API_TOKEN: 'browser-token',
			SOURCE_QUEUE: { send },
		};
		const source = await addSource(browserEnv as any, {
			identifier: 'https://example.com/blog',
			kind: 'browser',
			name: 'Example Blog',
			userId: TEST_USER_ID,
		});
		await env.KEEPROOT_DB.prepare(
			'UPDATE sources SET last_success_at = ? WHERE id = ?',
		).bind('2026-08-12T12:00:00.000Z', source.id).run();
		const article = (index: number, publishedAt: string) => ({
			html: `<!doctype html><html><head>
				<link rel="canonical" href="https://example.com/posts/${index}">
				<script type="application/ld+json">${JSON.stringify({
					'@context': 'https://schema.org',
					'@type': 'BlogPosting',
					datePublished: publishedAt,
					headline: `Post ${index}`,
				})}</script>
			</head><body><article><h1>Post ${index}</h1>
				<p>This is a complete article paragraph for post ${index}, with enough useful text for readable extraction.</p>
				<p>A second paragraph preserves the shared HTML to Markdown content path.</p>
			</article></body></html>`,
			metadata: { status: 200, title: `Post ${index}`, url: `https://example.com/posts/${index}` },
			status: 'completed',
			url: `https://example.com/posts/${index}`,
		});
		const initialRecords = Array.from({ length: 26 }, (_, index) =>
			article(index + 1, new Date(Date.UTC(2026, 7, index + 1)).toISOString()));
		const jobs = new Map([
			['crawl-initial', initialRecords.slice(21)],
			['crawl-new', [article(27, '2026-08-27T12:00:00.000Z')]],
		]);
		const jobIds = [...jobs.keys()];
		const startBodies: Array<Record<string, unknown>> = [];
		let sitemapRequestCount = 0;
		const sitemap = (postCount: number) => `<?xml version="1.0" encoding="UTF-8"?>
			<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
				<url><loc>https://example.com/blog</loc><lastmod>2026-08-01</lastmod></url>
				${Array.from({ length: postCount }, (_, index) => `<url>
					<loc>https://example.com/posts/${index + 1}</loc>
					<lastmod>${new Date(Date.UTC(2026, 7, index + 1)).toISOString()}</lastmod>
				</url>`).join('')}
			</urlset>`;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
			if (url.origin === 'https://example.com' && url.pathname === '/robots.txt') {
				return new Response('Sitemap: https://example.com/sitemap.xml', {
					headers: { 'Content-Type': 'text/plain' },
				});
			}
			if (url.origin === 'https://example.com' && url.pathname === '/sitemap.xml') {
				sitemapRequestCount += 1;
				return new Response(sitemap(sitemapRequestCount === 1 ? 26 : 27), {
					headers: { 'Content-Type': 'application/xml' },
				});
			}
			if (url.pathname.endsWith('/browser-rendering/crawl') && init?.method === 'POST') {
				startBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
				return Response.json({ success: true, result: jobIds.shift() });
			}
			const jobId = url.pathname.split('/').at(-1) ?? '';
			const records = jobs.get(jobId) ?? [];
			const limit = Number(url.searchParams.get('limit') ?? 25);
			const offset = Number(url.searchParams.get('cursor') ?? 0);
			const nextOffset = Math.min(offset + limit, records.length);
			return Response.json({
				success: true,
				result: {
					cursor: limit === 1 || nextOffset >= records.length ? null : String(nextOffset),
					finished: records.length,
					id: jobId,
					records: limit === 1 ? [] : records.slice(offset, nextOffset),
					status: 'completed',
					total: records.length,
				},
			});
		});

		const runToCompletion = async (runType: string) => {
			const { runId } = await enqueueSourceRun(browserEnv as any, String(source.id), runType);
			let outcome: Awaited<ReturnType<typeof processSourceQueueJob>> = 'ignored';
			for (let delivery = 0; delivery < 12 && outcome !== 'completed'; delivery += 1) {
				outcome = await processSourceQueueJob(browserEnv as any, { runId, sourceId: String(source.id) }, 1);
			}
			expect(outcome).toBe('completed');
			return runId;
		};

		const initialRunId = await runToCompletion('browser-initial');
		const initialStates = await env.KEEPROOT_DB.prepare(
			`SELECT state, COUNT(*) AS count FROM source_discoveries
			WHERE source_id = ? GROUP BY state ORDER BY state`,
		).bind(source.id).all<{ count: number; state: string }>();
		expect(initialStates.results).toEqual([{ count: 5, state: 'imported' }]);
		const initialSitemapStates = await env.KEEPROOT_DB.prepare(
			`SELECT state, COUNT(*) AS count FROM source_sitemap_urls
			WHERE source_id = ? GROUP BY state ORDER BY state`,
		).bind(source.id).all<{ count: number; state: string }>();
		expect(initialSitemapStates.results).toEqual([
			{ count: 22, state: 'baselined' },
			{ count: 5, state: 'processed' },
		]);
		const initialBookmarks = await env.KEEPROOT_DB.prepare(
			'SELECT source_entry_id FROM bookmarks WHERE source_id = ? ORDER BY source_entry_id',
		).bind(source.id).all<{ source_entry_id: string }>();
		expect(initialBookmarks.results).toHaveLength(5);
		expect(initialBookmarks.results.map((row) => row.source_entry_id)).toEqual([
			'https://example.com/posts/22',
			'https://example.com/posts/23',
			'https://example.com/posts/24',
			'https://example.com/posts/25',
			'https://example.com/posts/26',
		]);
		const initialRun = await env.KEEPROOT_DB.prepare(
			'SELECT status, examined_count, discovered_count, created_count, skipped_count FROM source_runs WHERE id = ?',
		).bind(initialRunId).first<Record<string, number | string>>();
		expect(initialRun).toMatchObject({
			created_count: 5,
			discovered_count: 5,
			examined_count: 5,
			skipped_count: 0,
			status: 'success',
		});

		await runToCompletion('browser-new');
		const unchangedRunId = await runToCompletion('browser-unchanged');
		const finalBookmarks = await env.KEEPROOT_DB.prepare(
			'SELECT source_entry_id FROM bookmarks WHERE source_id = ? ORDER BY source_entry_id',
		).bind(source.id).all<{ source_entry_id: string }>();
		expect(finalBookmarks.results).toHaveLength(6);
		expect(finalBookmarks.results.filter((row) => row.source_entry_id === 'https://example.com/posts/27')).toHaveLength(1);
		const latestRun = await env.KEEPROOT_DB.prepare(
			'SELECT status, created_count, error_count FROM source_runs WHERE id = ?',
		).bind(unchangedRunId).first<{ created_count: number; error_count: number; status: string }>();
		expect(latestRun).toEqual({ created_count: 0, error_count: 0, status: 'success' });

		expect(startBodies[0]).toMatchObject({
			crawlPurposes: ['search', 'ai-input'],
			depth: 5,
			formats: ['html'],
			limit: 5,
			maxAge: 0,
			options: {
				includeExternalLinks: false,
				includePatterns: [
					'https://example.com/posts/26',
					'https://example.com/posts/25',
					'https://example.com/posts/24',
					'https://example.com/posts/23',
					'https://example.com/posts/22',
				],
				includeSubdomains: false,
			},
			rejectResourceTypes: ['image', 'media', 'font'],
			render: true,
			source: 'sitemaps',
			url: 'https://example.com/blog',
		});
		expect(startBodies[0]).not.toHaveProperty('modifiedSince');
		expect(startBodies[1]).toMatchObject({
			limit: 1,
			options: { includePatterns: ['https://example.com/posts/27'] },
			source: 'sitemaps',
		});
		expect(startBodies[1]).not.toHaveProperty('modifiedSince');
		expect(startBodies).toHaveLength(2);
	});

	it('coalesces Browser Run refreshes, cancels orphaned runs, and clears a stale source error', async () => {
		const send = vi.fn().mockResolvedValue({});
		const browserEnv = {
			...env,
			BROWSER_RUN_ACCOUNT_ID: 'browser-account',
			BROWSER_RUN_API_TOKEN: 'browser-token',
			SOURCE_QUEUE: { send },
		};
		const source = await addSource(browserEnv as any, {
			identifier: 'https://example.com/blog',
			kind: 'browser',
			name: 'Example Blog',
			userId: TEST_USER_ID,
		});
		const now = new Date().toISOString();
		await env.KEEPROOT_DB.batch([
			env.KEEPROOT_DB.prepare(
				`UPDATE sources SET last_error = ? WHERE id = ?`,
			).bind('Browser Run crawl failed (401): Authentication error', source.id),
			env.KEEPROOT_DB.prepare(
				`INSERT INTO source_runs
				(id, source_id, run_type, status, dispatch_key, queued_at, started_at)
				VALUES ('orphan-run', ?, 'manual', 'retrying', 'manual:orphan-run', ?, ?)`,
			).bind(source.id, now, now),
		]);
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
			success: true,
			result: 'accepted-crawl-id',
		}));

		const first = await enqueueSourceRun(browserEnv as any, String(source.id), 'manual');
		const duplicate = await enqueueSourceRun(browserEnv as any, String(source.id), 'manual');

		expect(first).toMatchObject({ queued: true, runId: expect.any(String) });
		expect(duplicate).toEqual({ queued: false, runId: first.runId });
		expect(send).toHaveBeenCalledOnce();
		await expect(processSourceQueueJob(browserEnv as any, {
			runId: first.runId,
			sourceId: String(source.id),
		}, 1)).resolves.toBe('continued');

		const sourceState = await env.KEEPROOT_DB.prepare(
			'SELECT active_run_id, last_error FROM sources WHERE id = ?',
		).bind(source.id).first<{ active_run_id: string | null; last_error: string | null }>();
		const orphan = await env.KEEPROOT_DB.prepare(
			'SELECT status, finished_at, error_text FROM source_runs WHERE id = ?',
		).bind('orphan-run').first<{ error_text: string | null; finished_at: string | null; status: string }>();
		const activeRun = await env.KEEPROOT_DB.prepare(
			'SELECT status, upstream_job_id FROM source_runs WHERE id = ?',
		).bind(first.runId).first<{ status: string; upstream_job_id: string | null }>();

		expect(sourceState).toEqual({ active_run_id: first.runId, last_error: null });
		expect(orphan).toMatchObject({
			error_text: `Superseded by active source run ${first.runId}`,
			status: 'cancelled',
		});
		expect(orphan?.finished_at).toBeTruthy();
		expect(activeRun).toEqual({ status: 'waiting', upstream_job_id: 'accepted-crawl-id' });
		const logs = logSpy.mock.calls.map(([line]) => String(line));
		expect(logs.some((line) => line.includes('source_run_coalesced'))).toBe(true);
		expect(logs.some((line) => line.includes('browser_crawl_started') && line.includes('accepted-crawl-id'))).toBe(true);
		expect(logs.join('\n')).not.toContain('browser-token');
		expect(logs.join('\n')).not.toContain('https://example.com/blog');
	});

	it('terminalises a queued run that loses the source lease race', async () => {
		const browserEnv = {
			...env,
			BROWSER_RUN_ACCOUNT_ID: 'browser-account',
			BROWSER_RUN_API_TOKEN: 'browser-token',
			SOURCE_QUEUE: { send: vi.fn().mockResolvedValue({}) },
		};
		const source = await addSource(browserEnv as any, {
			identifier: 'https://example.com/blog',
			kind: 'browser',
			name: 'Example Blog',
			userId: TEST_USER_ID,
		});
		const now = new Date();
		const queuedAt = now.toISOString();
		const leaseExpiresAt = new Date(now.getTime() + 10 * 60 * 1_000).toISOString();
		await env.KEEPROOT_DB.batch([
			env.KEEPROOT_DB.prepare(
				`INSERT INTO source_runs
				(id, source_id, run_type, status, dispatch_key, queued_at, started_at, lease_expires_at)
				VALUES ('active-run', ?, 'manual', 'waiting', 'manual:active-run', ?, ?, ?)`,
			).bind(source.id, queuedAt, queuedAt, leaseExpiresAt),
			env.KEEPROOT_DB.prepare(
				`INSERT INTO source_runs
				(id, source_id, run_type, status, dispatch_key, queued_at, started_at)
				VALUES ('duplicate-run', ?, 'manual', 'queued', 'manual:duplicate-run', ?, ?)`,
			).bind(source.id, queuedAt, queuedAt),
			env.KEEPROOT_DB.prepare(
				`UPDATE sources SET active_run_id = 'active-run', lease_expires_at = ? WHERE id = ?`,
			).bind(leaseExpiresAt, source.id),
		]);

		await expect(processSourceQueueJob(browserEnv as any, {
			runId: 'duplicate-run',
			sourceId: String(source.id),
		}, 1)).resolves.toBe('ignored');

		const duplicate = await env.KEEPROOT_DB.prepare(
			'SELECT status, finished_at, error_text FROM source_runs WHERE id = ?',
		).bind('duplicate-run').first<{ error_text: string | null; finished_at: string | null; status: string }>();
		const sourceState = await env.KEEPROOT_DB.prepare(
			'SELECT active_run_id, lease_expires_at FROM sources WHERE id = ?',
		).bind(source.id).first<{ active_run_id: string | null; lease_expires_at: string | null }>();

		expect(duplicate).toMatchObject({
			error_text: 'Superseded by another active source run',
			status: 'cancelled',
		});
		expect(duplicate?.finished_at).toBeTruthy();
		expect(sourceState).toEqual({ active_run_id: 'active-run', lease_expires_at: leaseExpiresAt });
	});

	it('fails an initial Browser Run crawl that recognises no posts', async () => {
		const send = vi.fn().mockResolvedValue({});
		const browserEnv = {
			...env,
			BROWSER_RUN_ACCOUNT_ID: 'browser-account',
			BROWSER_RUN_API_TOKEN: 'browser-token',
			SOURCE_QUEUE: { send },
		};
		const source = await addSource(browserEnv as any, {
			identifier: 'https://empty.example/blog',
			kind: 'browser',
			name: 'Empty Blog',
			userId: TEST_USER_ID,
		});
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
			if (url.pathname.endsWith('/browser-rendering/crawl') && init?.method === 'POST') {
				return Response.json({ success: true, result: 'crawl-empty' });
			}
			const pollOnly = url.searchParams.get('limit') === '1';
			return Response.json({ success: true, result: {
				cursor: null,
				finished: 1,
				id: 'crawl-empty',
				records: pollOnly ? [] : [{
					html: '<html><head><title>Blog home</title></head><body>No article metadata</body></html>',
					status: 'completed',
					url: 'https://empty.example/blog',
				}],
				status: 'completed',
				total: 1,
			} });
		});
		const { runId } = await enqueueSourceRun(browserEnv as any, String(source.id), 'browser-empty');

		await expect(processSourceQueueJob(browserEnv as any, { runId, sourceId: String(source.id) }, 1)).resolves.toBe('continued');
		await expect(processSourceQueueJob(browserEnv as any, { runId, sourceId: String(source.id) }, 1)).resolves.toBe('continued');
		await expect(processSourceQueueJob(browserEnv as any, { runId, sourceId: String(source.id) }, 1)).resolves.toBe('completed');

		const failedRun = await env.KEEPROOT_DB.prepare(
			'SELECT status, error_text, examined_count, discovered_count FROM source_runs WHERE id = ?',
		).bind(runId).first<{ discovered_count: number; error_text: string; examined_count: number; status: string }>();
		expect(failedRun).toMatchObject({ discovered_count: 0, examined_count: 1, status: 'error' });
		expect(failedRun?.error_text).toContain('found no blog posts with recognised article metadata');
	});

	it('acknowledges an inactive or missing source run message independently', async () => {
		const ack = vi.fn();
		const retry = vi.fn();
		await worker.queue({
			ackAll: vi.fn(),
			messages: [{
				ack,
				attempts: 1,
				body: { runId: 'missing-run', sourceId: 'missing-source' },
				id: 'message-1',
				retry,
				timestamp: new Date(),
			}],
			metadata: { metrics: { backlogBytes: 0, backlogCount: 0 } },
			queue: 'keeproot-source-ingest',
			retryAll: vi.fn(),
		} as MessageBatch<any>, env, createExecutionContext());

		expect(ack).toHaveBeenCalledOnce();
		expect(retry).not.toHaveBeenCalled();
	});

	it('requires bearer authentication for MCP requests', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch(new Request('http://example.com/mcp', {
			method: 'POST',
			headers: {
				Accept: 'application/json, text/event-stream',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				id: 0,
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					capabilities: {},
					clientInfo: { name: 'unauthorised-test', version: '1.0.0' },
					protocolVersion: LEGACY_MCP_PROTOCOL_VERSION,
				},
			}),
		}), env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toEqual({ error: 'Unauthorized' });
	});

	it('supports the Claude legacy initialise handshake without a protocol session', async () => {
		const response = await rawMcpRequest({
			id: 0,
			jsonrpc: '2.0',
			method: 'initialize',
			params: {
				capabilities: {
					extensions: {
						'io.modelcontextprotocol/ui': {
							mimeTypes: ['text/html;profile=mcp-app'],
						},
					},
				},
				clientInfo: {
					name: 'claude-ai',
					version: '0.1.0',
				},
				protocolVersion: LEGACY_MCP_PROTOCOL_VERSION,
			},
		});
		const data = await parseMcpResponse(response);

		expect(response.status).toBe(200);
		expect(response.headers.get('mcp-session-id')).toBeNull();
		expect(data.error).toBeUndefined();
		expect(data.result.protocolVersion).toBe(LEGACY_MCP_PROTOCOL_VERSION);
		expect(data.result.capabilities.tools).toBeDefined();
		expect(data.result.serverInfo).toEqual({
			name: 'keeproot-mcp',
			version: '1.0.0',
		});

		const initializedResponse = await rawMcpRequest({
			jsonrpc: '2.0',
			method: 'notifications/initialized',
		});
		expect(initializedResponse.status).toBe(202);

		const toolsResponse = await mcpRequest('tools/list');
		expect(toolsResponse.response.status).toBe(200);
		expect(toolsResponse.response.headers.get('mcp-session-id')).toBeNull();
		expect(toolsResponse.data.result.tools.length).toBeGreaterThan(0);
	});

	it('supports modern MCP discovery and stateless tool listing', async () => {
		const discovery = await modernMcpRequest('server/discover');

		expect(discovery.response.status).toBe(200);
		expect(discovery.response.headers.get('mcp-session-id')).toBeNull();
		expect(discovery.data.error).toBeUndefined();
		expect(discovery.data.result.resultType).toBe('complete');
		expect(discovery.data.result.supportedVersions).toContain(MODERN_MCP_PROTOCOL_VERSION);
		expect(discovery.data.result.capabilities.tools).toBeDefined();
		expect(discovery.data.result._meta['io.modelcontextprotocol/serverInfo']).toEqual({
			name: 'keeproot-mcp',
			version: '1.0.0',
		});

		const toolsResponse = await modernMcpRequest('tools/list');
		expect(toolsResponse.response.status).toBe(200);
		expect(toolsResponse.data.error).toBeUndefined();
		expect(toolsResponse.data.result.resultType).toBe('complete');
		expect(toolsResponse.data.result.tools.map((tool: { name: string }) => tool.name))
			.toEqual(expect.arrayContaining(['save_item', 'search_items', 'whoami']));

		const whoAmI = await modernMcpRequest('tools/call', {
			arguments: {},
			name: 'whoami',
		}, {
			'Mcp-Name': 'whoami',
		});
		expect(whoAmI.response.status).toBe(200);
		expect(whoAmI.data.error).toBeUndefined();
		expect(whoAmI.data.result.resultType).toBe('complete');
		expect(extractToolPayload(whoAmI.data.result).account.username).toBe(TEST_USERNAME);
	});

	it('rejects untrusted browser origins on the MCP endpoint', async () => {
		const response = await rawMcpRequest({
			id: 0,
			jsonrpc: '2.0',
			method: 'initialize',
			params: {
				capabilities: {},
				clientInfo: { name: 'origin-test', version: '1.0.0' },
				protocolVersion: LEGACY_MCP_PROTOCOL_VERSION,
			},
		}, {
			Origin: 'https://malicious.example',
		});

		expect(response.status).toBe(403);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});

	it('responds with 401 if empty token provided', async () => {
		const request = new Request('http://example.com/bookmarks', {
			headers: { 'Authorization': '' },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Unauthorized' });
	});

	it('responds with 401 if invalid token provided', async () => {
		const request = new Request('http://example.com/bookmarks', {
			headers: { Authorization: 'Bearer invalid-token' },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Unauthorized' });
	});

	it('accepts a preview-scoped session only on its preview Worker origin', async () => {
		const previewOrigin = 'https://feature-keeproot.example.workers.dev';
		const token = await createSession(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		}, { scopeOrigin: previewOrigin });
		const ctx = createExecutionContext();
		const response = await worker.fetch(new Request('https://keeproot.example.workers.dev/account', {
			headers: { Authorization: `Bearer ${token}` },
		}), env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Unauthorized' });

		const previewContext = createExecutionContext();
		const previewResponse = await worker.fetch(new Request(`${previewOrigin}/account`, {
			headers: { Authorization: `Bearer ${token}` },
		}), env, previewContext);
		await waitOnExecutionContext(previewContext);

		expect(previewResponse.status).toBe(200);
	});

	describe('handleAuthRoute', () => {
		it('directs preview hosts to the configured stable authentication origin', async () => {
			const request = new Request('https://feature-keeproot.example.workers.dev/auth/context');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, {
				...env,
				AUTH_ORIGIN: 'https://keeproot.example.workers.dev',
			}, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				authenticationOrigin: 'https://keeproot.example.workers.dev',
				requiresHandoff: true,
			});
		});

		it('hands an authenticated canonical session to an allowed preview origin', async () => {
			const authenticationOrigin = 'https://keeproot.example.workers.dev';
			const previewOrigin = 'https://feature-keeproot.example.workers.dev';
			const canonicalToken = await createSession(env, {
				userId: TEST_USER_ID,
				username: TEST_USERNAME,
			});
			const request = new Request(`${authenticationOrigin}/auth/preview-session?return_to=${encodeURIComponent(previewOrigin)}`, {
				headers: { Cookie: `keeproot_session=${canonicalToken}` },
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, {
				...env,
				AUTH_ORIGIN: authenticationOrigin,
			}, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(302);
			const location = new URL(response.headers.get('Location')!);
			expect(location.origin).toBe(previewOrigin);
			expect(location.pathname).toBe('/');
			expect(location.hash).toMatch(/^#preview_session=preview\.v1\./);
		});

		it('does not let an API key mint a preview dashboard session', async () => {
			const authenticationOrigin = 'https://keeproot.example.workers.dev';
			const previewOrigin = 'https://feature-keeproot.example.workers.dev';
			const request = new Request(`${authenticationOrigin}/auth/preview-session?return_to=${encodeURIComponent(previewOrigin)}`, {
				headers: { Authorization: `Bearer ${API_KEY}` },
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, {
				...env,
				AUTH_ORIGIN: authenticationOrigin,
			}, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({ error: 'Session authentication required' });
		});

		it('keeps registration disabled when explicitly disabled', async () => {
			const request = new Request('http://example.com/auth/generate-registration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'new-user' }),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, envWithRegistrationDisabled(), ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({ error: 'Registration is disabled' });
		});

		it('enables registration in the standard test environment', async () => {
			const request = new Request('http://example.com/auth/generate-registration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: 'Username required' });
		});

		it('does not reveal that a user already exists during registration generation', async () => {
			await createUserWithCredential(env, 'existing-user', 'user-id', {
				backedUp: false,
				counter: 0,
				credentialId: 'cred-id',
				deviceType: null,
				publicKey: new Uint8Array([1]),
				transports: ['internal'],
			});
			generateRegistrationOptionsMock.mockResolvedValue({
				challenge: 'registration-challenge',
			});

			const request = new Request('http://example.com/auth/generate-registration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'existing-user' }),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, envWithRegistrationEnabled(), ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ challenge: 'registration-challenge' });
		});

		it('generates registration options successfully', async () => {
			generateRegistrationOptionsMock.mockResolvedValue({
				challenge: 'registration-challenge',
			});

			const request = new Request('http://example.com/auth/generate-registration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'new-user' }),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, envWithRegistrationEnabled(), ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ challenge: 'registration-challenge' });
			expect(generateRegistrationOptionsMock).toHaveBeenCalledTimes(1);
			const mockCalls = generateRegistrationOptionsMock.mock.calls;
			expect(mockCalls[0][0].userName).toBe('new-user');
		});

		it('responds with 400 if invalid payload provided for verify registration', async () => {
			const request = new Request('http://example.com/auth/verify-registration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'new-user' }), // missing response
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, envWithRegistrationEnabled(), ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: 'Invalid registration payload' });
		});

		it('responds with 400 if session expired for verify registration', async () => {
			const request = new Request('http://example.com/auth/verify-registration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'new-user', response: {} }),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, envWithRegistrationEnabled(), ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: 'Registration failed' });
		});

		it('responds with 400 if user already exists during verify registration', async () => {
			await storeAuthChallenge(env, {
				challenge: 'registration-challenge',
				type: 'registration',
				userId: 'user-id',
				username: 'existing-user',
			});

			await createUserWithCredential(env, 'existing-user', 'user-id', {
				backedUp: false,
				counter: 0,
				credentialId: 'cred-id',
				deviceType: null,
				publicKey: new Uint8Array([1]),
				transports: ['internal'],
			});

			verifyRegistrationResponseMock.mockResolvedValue({
				registrationInfo: {
					credential: {
						counter: 0,
						id: 'registration-credential',
						publicKey: new Uint8Array([1, 2, 3]),
						transports: ['internal'],
					},
					credentialBackedUp: false,
					credentialDeviceType: 'singleDevice',
				},
				verified: true,
			});

			const request = new Request('http://example.com/auth/verify-registration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'existing-user', response: { rawId: 'registration-credential' } }),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, envWithRegistrationEnabled(), ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: 'Registration failed' });
		});

		it('verifies registration successfully and creates a token', async () => {
			await storeAuthChallenge(env, {
				challenge: 'registration-challenge',
				type: 'registration',
				userId: 'registration-user-id',
				username: 'new-user',
			});

			verifyRegistrationResponseMock.mockResolvedValue({
				registrationInfo: {
					credential: {
						counter: 0,
						id: 'registration-credential',
						publicKey: new Uint8Array([1, 2, 3]),
						transports: ['internal'],
					},
					credentialBackedUp: false,
					credentialDeviceType: 'singleDevice',
				},
				verified: true,
			});

			const request = new Request('http://example.com/auth/verify-registration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					response: {
						rawId: 'registration-credential',
					},
					username: 'new-user',
				}),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, envWithRegistrationEnabled(), ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data).toHaveProperty('token');
			expect(data).toHaveProperty('verified', true);
		});

		it('responds with 400 if username missing during generate authentication', async () => {
			const request = new Request('http://example.com/auth/generate-authentication', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: 'Username required' });
		});

		it('does not reveal that a user is missing during authentication generation', async () => {
			generateAuthenticationOptionsMock.mockResolvedValue({
				challenge: 'auth-challenge',
			});
			const createRequest = () => new Request('http://example.com/auth/generate-authentication', {
				method: 'POST',
				headers: {
					'CF-Connecting-IP': '203.0.113.50',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ username: 'nonexistent-user' }),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(createRequest(), env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ challenge: 'auth-challenge' });
			expect(generateAuthenticationOptionsMock).toHaveBeenCalledTimes(1);
			const firstAllowCredentials = generateAuthenticationOptionsMock.mock.calls[0][0].allowCredentials;
			expect(firstAllowCredentials).toEqual([
				{
					id: expect.stringMatching(/^[0-9a-f]{32}$/),
				},
			]);

			const retryContext = createExecutionContext();
			const retryResponse = await worker.fetch(createRequest(), env, retryContext);
			await waitOnExecutionContext(retryContext);
			expect(retryResponse.status).toBe(200);
			expect(generateAuthenticationOptionsMock.mock.calls[1][0].allowCredentials).toEqual(firstAllowCredentials);
		});

		it('limits authentication to credentials registered for the supplied username', async () => {
			await createUserWithCredential(env, 'existing-user', 'user-id', {
				backedUp: false,
				counter: 0,
				credentialId: 'cred-id',
				deviceType: null,
				publicKey: new Uint8Array([1]),
				transports: ['internal'],
			});

			generateAuthenticationOptionsMock.mockResolvedValue({
				challenge: 'auth-challenge',
			});

			const request = new Request('http://example.com/auth/generate-authentication', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'existing-user' }),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ challenge: 'auth-challenge' });
			expect(generateAuthenticationOptionsMock).toHaveBeenCalledTimes(1);
			const mockCalls = generateAuthenticationOptionsMock.mock.calls;
			expect(mockCalls[0][0].allowCredentials).toEqual([
				{
					id: 'cred-id',
				},
			]);
		});

		it('responds with 400 if invalid payload provided for verify authentication', async () => {
			const request = new Request('http://example.com/auth/verify-authentication', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'existing-user' }),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: 'Invalid authentication payload' });
		});

		it('responds with 400 if session expired for verify authentication', async () => {
			const request = new Request('http://example.com/auth/verify-authentication', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'existing-user', response: {} }),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: 'Authentication failed' });
		});

		it('uses the generic authentication failure when a user is missing during verification', async () => {
			await storeAuthChallenge(env, {
				challenge: 'auth-challenge',
				type: 'authentication',
				userId: 'user-id',
				username: 'nonexistent-user',
			});

			const request = new Request('http://example.com/auth/verify-authentication', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'nonexistent-user', response: {} }),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: 'Authentication failed' });
		});

		it('responds with 400 if authenticator not registered for verify authentication', async () => {
			await createUserWithCredential(env, 'existing-user', 'user-id', {
				backedUp: false,
				counter: 0,
				credentialId: 'cred-id',
				deviceType: null,
				publicKey: new Uint8Array([1]),
				transports: ['internal'],
			});

			await storeAuthChallenge(env, {
				challenge: 'auth-challenge',
				type: 'authentication',
				userId: 'user-id',
				username: 'existing-user',
			});

			const request = new Request('http://example.com/auth/verify-authentication', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'existing-user', response: { rawId: 'unregistered-cred-id' } }),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: 'Authentication failed' });
		});

		it('responds with 400 if verification fails during verify authentication', async () => {
			await createUserWithCredential(env, 'existing-user', 'user-id', {
				backedUp: false,
				counter: 0,
				credentialId: 'cred-id',
				deviceType: null,
				publicKey: new Uint8Array([1]),
				transports: ['internal'],
			});

			await storeAuthChallenge(env, {
				challenge: 'auth-challenge',
				type: 'authentication',
				userId: 'user-id',
				username: 'existing-user',
			});

			verifyAuthenticationResponseMock.mockResolvedValue({
				verified: false,
			});

			const request = new Request('http://example.com/auth/verify-authentication', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'existing-user', response: { rawId: 'cred-id' } }),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: 'Authentication failed' });
		});

		it('verifies authentication successfully and creates a token', async () => {
			await createUserWithCredential(env, 'existing-user', 'user-id', {
				backedUp: false,
				counter: 0,
				credentialId: 'cred-id',
				deviceType: null,
				publicKey: new Uint8Array([1]),
				transports: ['internal'],
			});

			await storeAuthChallenge(env, {
				challenge: 'auth-challenge',
				type: 'authentication',
				userId: 'user-id',
				username: 'existing-user',
			});

			verifyAuthenticationResponseMock.mockResolvedValue({
				authenticationInfo: {
					newCounter: 1,
				},
				verified: true,
			});

			const request = new Request('https://example.com/auth/verify-authentication', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'existing-user', response: { rawId: 'cred-id' } }),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			const data = await response.json() as { token: string; verified: boolean };
			expect(data).toHaveProperty('token');
			expect(data).toHaveProperty('verified', true);

			const setCookie = response.headers.get('Set-Cookie');
			expect(setCookie).toContain(`keeproot_session=${data.token}`);
			expect(setCookie).toContain('Max-Age=604800');
			expect(setCookie).toContain('HttpOnly');
			expect(setCookie).toContain('SameSite=Strict');
			expect(setCookie).toContain('Secure');

			const cookie = setCookie!.split(';', 1)[0];
			const accountContext = createExecutionContext();
			const accountResponse = await worker.fetch(new Request('https://example.com/account', {
				headers: { Cookie: cookie },
			}), env, accountContext);
			await waitOnExecutionContext(accountContext);
			expect(accountResponse.status).toBe(200);

			const crossOriginLogoutContext = createExecutionContext();
			const crossOriginLogoutResponse = await worker.fetch(new Request('https://example.com/auth/logout', {
				headers: {
					Cookie: cookie,
					Origin: 'https://attacker.example',
				},
				method: 'POST',
			}), env, crossOriginLogoutContext);
			await waitOnExecutionContext(crossOriginLogoutContext);
			expect(crossOriginLogoutResponse.status).toBe(401);

			const logoutContext = createExecutionContext();
			const logoutResponse = await worker.fetch(new Request('https://example.com/auth/logout', {
				headers: {
					Cookie: cookie,
					Origin: 'https://example.com',
				},
				method: 'POST',
			}), env, logoutContext);
			await waitOnExecutionContext(logoutContext);
			expect(logoutResponse.status).toBe(200);
			expect(logoutResponse.headers.get('Set-Cookie')).toContain('Max-Age=0');
		});
	});

	it('revokes the current server-side session on logout', async () => {
		const sessionToken = await createSession(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		});
		const logoutContext = createExecutionContext();
		const logoutResponse = await worker.fetch(new Request('http://example.com/auth/logout', {
			method: 'POST',
			headers: { Authorization: `Bearer ${sessionToken}` },
		}), env, logoutContext);
		await waitOnExecutionContext(logoutContext);

		expect(logoutResponse.status).toBe(200);
		expect(await logoutResponse.json()).toEqual({ message: 'Logged out' });

		const retryContext = createExecutionContext();
		const retryResponse = await worker.fetch(new Request('http://example.com/bookmarks', {
			headers: { Authorization: `Bearer ${sessionToken}` },
		}), env, retryContext);
		await waitOnExecutionContext(retryContext);
		expect(retryResponse.status).toBe(401);
	});

	it('can revoke every session for the signed-in user', async () => {
		const firstSession = await createSession(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		});
		const secondSession = await createSession(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		});
		const logoutContext = createExecutionContext();
		const logoutResponse = await worker.fetch(new Request('http://example.com/auth/logout-all', {
			method: 'POST',
			headers: { Authorization: `Bearer ${firstSession}` },
		}), env, logoutContext);
		await waitOnExecutionContext(logoutContext);

		expect(logoutResponse.status).toBe(200);
		expect((await logoutResponse.json() as { revoked: number }).revoked).toBe(2);

		for (const token of [firstSession, secondSession]) {
			const retryContext = createExecutionContext();
			const retryResponse = await worker.fetch(new Request('http://example.com/bookmarks', {
				headers: { Authorization: `Bearer ${token}` },
			}), env, retryContext);
			await waitOnExecutionContext(retryContext);
			expect(retryResponse.status).toBe(401);
		}
	});
	it('accepts browser extension origins during passkey registration verification', async () => {
		verifyRegistrationResponseMock.mockResolvedValue({
			registrationInfo: {
				credential: {
					counter: 0,
					id: 'registration-credential',
					publicKey: new Uint8Array([1, 2, 3]),
					transports: ['internal'],
				},
				credentialBackedUp: false,
				credentialDeviceType: 'singleDevice',
			},
			verified: true,
		});
		await storeAuthChallenge(env, {
			challenge: 'registration-challenge',
			type: 'registration',
			userId: 'registration-user-id',
			username: 'passkey-registration-user',
		});

		const request = new Request('http://example.com/auth/verify-registration', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'chrome-extension://keeproot',
			},
			body: JSON.stringify({
				response: {
					rawId: 'registration-credential',
				},
				username: 'passkey-registration-user',
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, envWithRegistrationEnabled(envWithAllowedExtensionIds('keeproot')), ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(verifyRegistrationResponseMock).toHaveBeenCalledTimes(1);
		expect(verifyRegistrationResponseMock.mock.calls[0][0].expectedOrigin).toEqual([
			'http://example.com',
			'chrome-extension://keeproot',
		]);
	});

	it('rejects unapproved browser extension origins during passkey registration verification', async () => {
		verifyRegistrationResponseMock.mockImplementation(async ({ expectedOrigin }) => {
			expect(expectedOrigin).toEqual(['http://example.com']);
			throw new Error('Unexpected origin');
		});
		await storeAuthChallenge(env, {
			challenge: 'registration-challenge',
			type: 'registration',
			userId: 'registration-user-id',
			username: 'passkey-registration-user',
		});

		const request = new Request('http://example.com/auth/verify-registration', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'chrome-extension://not-allowed',
			},
			body: JSON.stringify({
				response: {
					rawId: 'registration-credential',
				},
				username: 'passkey-registration-user',
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, envWithRegistrationEnabled(envWithAllowedExtensionIds('keeproot')), ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Registration failed' });
	});

	it('accepts browser extension origins during passkey authentication verification', async () => {
		await createUserWithCredential(env, 'passkey-auth-user', 'passkey-auth-user-id', {
			backedUp: false,
			counter: 0,
			credentialId: 'authentication-credential',
			deviceType: null,
			publicKey: new Uint8Array([4, 5, 6]),
			transports: ['internal'],
		});
		await storeAuthChallenge(env, {
			challenge: 'authentication-challenge',
			type: 'authentication',
			userId: 'passkey-auth-user-id',
			username: 'passkey-auth-user',
		});
		verifyAuthenticationResponseMock.mockResolvedValue({
			authenticationInfo: {
				newCounter: 1,
			},
			verified: true,
		});

		const request = new Request('http://example.com/auth/verify-authentication', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'chrome-extension://keeproot',
			},
			body: JSON.stringify({
				response: {
					rawId: 'authentication-credential',
				},
				username: 'passkey-auth-user',
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, envWithAllowedExtensionIds('keeproot'), ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(verifyAuthenticationResponseMock).toHaveBeenCalledTimes(1);
		expect(verifyAuthenticationResponseMock.mock.calls[0][0].expectedOrigin).toEqual([
			'http://example.com',
			'chrome-extension://keeproot',
		]);
	});

	it('responds with 200 and CORS headers for OPTIONS request', async () => {
		const request = new Request('http://example.com/bookmarks', {
			method: 'OPTIONS',
			headers: {
				Origin: 'chrome-extension://abcdef',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, envWithAllowedExtensionIds('abcdef'), ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://abcdef');
		expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PATCH, DELETE, OPTIONS');
		expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization');

		const text = await response.text();
		expect(text).toBe('');
	});

	it('does not return an allowed origin for unapproved extension origins', async () => {
		const request = new Request('http://example.com/bookmarks', {
			method: 'OPTIONS',
			headers: {
				Origin: 'chrome-extension://abcdef',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, envWithAllowedExtensionIds('trusted-extension'), ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
	});

	it('does not return an allowed origin if the origin is not allowed', async () => {
		const request = new Request('http://example.com/bookmarks', {
			method: 'OPTIONS',
			headers: {
				Origin: 'http://malicious.com',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
	});

	it('authenticates with a valid API key', async () => {
		const request = new Request('http://example.com/bookmarks', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});

	it('applies browser isolation and privacy headers to every response', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch(new Request('http://example.com/'), env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
		expect(response.headers.get('Permissions-Policy')).toBe('camera=(), geolocation=(), microphone=(), payment=(), usb=()');
		expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
		expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
		expect(response.headers.get('Content-Security-Policy')).toContain("img-src 'self' blob:");
	});

	it('rate limits authentication traffic by connecting IP', async () => {
		const limit = vi.fn().mockResolvedValue({ success: false });
		const limitedEnv = {
			...env,
			AUTH_RATE_LIMITER: { limit },
		} as any;
		const ctx = createExecutionContext();
		const response = await worker.fetch(new Request('http://example.com/auth/generate-authentication', {
			method: 'POST',
			headers: {
				'CF-Connecting-IP': '203.0.113.8',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ username: 'testuser' }),
		}), limitedEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(429);
		expect(response.headers.get('Retry-After')).toBe('60');
		expect(limit).toHaveBeenCalledWith({ key: '203.0.113.8' });
	});

	it('rate limits authenticated bookmark saves by user', async () => {
		const limit = vi.fn().mockResolvedValue({ success: false });
		const limitedEnv = {
			...env,
			WRITE_RATE_LIMITER: { limit },
		} as any;
		const ctx = createExecutionContext();
		const response = await worker.fetch(new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ markdownData: '# Limited', url: 'https://example.com/limited' }),
		}), limitedEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(429);
		expect(limit).toHaveBeenCalledWith({ key: `${TEST_USER_ID}:bookmark-save` });
	});

	it('rate limits outbound MCP saves by user before invoking the tool', async () => {
		const limit = vi.fn().mockResolvedValue({ success: false });
		const limitedEnv = {
			...env,
			WRITE_RATE_LIMITER: { limit },
		} as any;
		const ctx = createExecutionContext();
		const response = await worker.fetch(new Request('http://example.com/mcp', {
			method: 'POST',
			headers: {
				Accept: 'application/json, text/event-stream',
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				id: 'limited-save',
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {
					arguments: { url: 'https://example.com/limited' },
					name: 'save_item',
				},
			}),
		}), limitedEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(429);
		expect(limit).toHaveBeenCalledWith({ key: `${TEST_USER_ID}:mcp-save-item` });
	});

	it('rate limits immediate source syncs by user', async () => {
		const limit = vi.fn().mockResolvedValue({ success: false });
		const limitedEnv = {
			...env,
			WRITE_RATE_LIMITER: { limit },
		} as any;
		const ctx = createExecutionContext();
		const response = await worker.fetch(new Request('http://example.com/sources', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				identifier: 'https://example.com/feed.xml',
				kind: 'rss',
			}),
		}), limitedEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(429);
		expect(limit).toHaveBeenCalledWith({ key: `${TEST_USER_ID}:source-sync` });
	});

	it('rate limits manual source refreshes by user', async () => {
		const limit = vi.fn().mockResolvedValue({ success: false });
		const limitedEnv = {
			...env,
			WRITE_RATE_LIMITER: { limit },
		} as any;
		const ctx = createExecutionContext();
		const response = await worker.fetch(new Request('http://example.com/sources/source-1/refresh', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
			},
		}), limitedEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(429);
		expect(limit).toHaveBeenCalledWith({ key: `${TEST_USER_ID}:source-sync` });
	});

	it('protects and serves MCP dashboard account and stats routes', async () => {
		const unauthorizedCtx = createExecutionContext();
		const unauthorizedResponse = await worker.fetch(new Request('http://example.com/account'), env, unauthorizedCtx);
		await waitOnExecutionContext(unauthorizedCtx);

		expect(unauthorizedResponse.status).toBe(401);
		expect(await unauthorizedResponse.json()).toEqual({ error: 'Unauthorized' });

		const accountCtx = createExecutionContext();
		const accountResponse = await worker.fetch(new Request('http://example.com/account', {
			headers: {
				Authorization: `Bearer ${API_KEY}`,
			},
		}), env, accountCtx);
		await waitOnExecutionContext(accountCtx);

		expect(accountResponse.status).toBe(200);
		const account = await accountResponse.json() as any;
		expect(account.account.username).toBe(TEST_USERNAME);
		expect(account.tokenType).toBe('api_key');

		const statsCtx = createExecutionContext();
		const statsResponse = await worker.fetch(new Request('http://example.com/stats', {
			headers: {
				Authorization: `Bearer ${API_KEY}`,
			},
		}), env, statsCtx);
		await waitOnExecutionContext(statsCtx);

		expect(statsResponse.status).toBe(200);
		const stats = await statsResponse.json() as any;
		expect(stats.items.total).toBe(0);
		expect(stats.sources.total).toBe(0);
		expect(stats.ingestion).toEqual(expect.objectContaining({
			dailyRefreshes: 0,
			health: 'green',
			queue: expect.objectContaining({ backlog: 0 }),
		}));
	});

	it('manages MCP sources through authenticated REST routes', async () => {
		(env as { MCP_EMAIL_DOMAIN?: string }).MCP_EMAIL_DOMAIN = 'mail.keeproot.test';
		mockTextFetch({
			'https://feeds.example.com/root.xml': {
				body: `<?xml version="1.0" encoding="UTF-8"?>
					<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
						<channel>
							<title>KeepRoot Feed</title>
							<item>
								<title>Feed Story</title>
								<link>https://feeds.example.com/posts/1</link>
								<description>Two-line teaser only.</description>
								<content:encoded><![CDATA[
									<h2>Full feed story</h2>
									<p>First complete paragraph from the source.</p>
									<p>Second complete paragraph from the source.</p>
								]]></content:encoded>
							</item>
						</channel>
					</rss>`,
				contentType: 'application/rss+xml; charset=utf-8',
			},
		});

		const emailCtx = createExecutionContext();
		const emailResponse = await worker.fetch(new Request('http://example.com/sources', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				identifier: 'weekly-digest',
				kind: 'email',
				name: 'Digest Inbox',
				syncNow: false,
			}),
		}), env, emailCtx);
		await waitOnExecutionContext(emailCtx);

		expect(emailResponse.status).toBe(201);
		const emailSource = await emailResponse.json() as any;
		expect(emailSource.kind).toBe('email');
		expect(emailSource.emailAlias).toContain('@mail.keeproot.test');

		const rssCtx = createExecutionContext();
		const rssResponse = await worker.fetch(new Request('http://example.com/sources', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				identifier: 'https://feeds.example.com/root.xml',
				kind: 'rss',
				name: 'Root Feed',
			}),
		}), env, rssCtx);
		await waitOnExecutionContext(rssCtx);

		expect(rssResponse.status).toBe(201);
		const rssSource = await rssResponse.json() as any;
		expect(rssSource.pollUrl).toBe('https://feeds.example.com/root.xml');

		const listCtx = createExecutionContext();
		const listResponse = await worker.fetch(new Request('http://example.com/sources', {
			headers: {
				Authorization: `Bearer ${API_KEY}`,
			},
		}), env, listCtx);
		await waitOnExecutionContext(listCtx);

		expect(listResponse.status).toBe(200);
		const listed = await listResponse.json() as any;
		expect(listed.sources).toHaveLength(2);

		const statsCtx = createExecutionContext();
		const statsResponse = await worker.fetch(new Request('http://example.com/stats', {
			headers: {
				Authorization: `Bearer ${API_KEY}`,
			},
		}), env, statsCtx);
		await waitOnExecutionContext(statsCtx);

		expect(statsResponse.status).toBe(200);
		const stats = await statsResponse.json() as any;
		expect(stats.sources.total).toBe(2);
		expect(stats.sources.byKind.email).toBe(1);
		expect(stats.sources.byKind.rss).toBe(1);
		expect(stats.inbox.pending).toBe(1);

		const deleteCtx = createExecutionContext();
		const deleteResponse = await worker.fetch(new Request(`http://example.com/sources/${rssSource.id}`, {
			method: 'DELETE',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
			},
		}), env, deleteCtx);
		await waitOnExecutionContext(deleteCtx);

		expect(deleteResponse.status).toBe(200);
		expect(await deleteResponse.json()).toEqual({ removed: true });

		const afterCtx = createExecutionContext();
		const afterResponse = await worker.fetch(new Request('http://example.com/sources', {
			headers: {
				Authorization: `Bearer ${API_KEY}`,
			},
		}), env, afterCtx);
		await waitOnExecutionContext(afterCtx);

		const afterRemoval = await afterResponse.json() as any;
		expect(afterRemoval.sources).toHaveLength(1);
		expect(afterRemoval.sources[0].kind).toBe('email');

		const runsBeforeReAdd = await env.KEEPROOT_DB.prepare(
			'SELECT COUNT(*) AS count FROM source_runs WHERE source_id = ?',
		)
			.bind(rssSource.id)
			.first<{ count: number }>();
		const importedBookmark = await env.KEEPROOT_DB.prepare(
			'SELECT id, source_id FROM bookmarks WHERE url = ? LIMIT 1',
		)
			.bind('https://feeds.example.com/posts/1')
			.first<{ id: string; source_id: string | null }>();
		if (!importedBookmark) {
			throw new Error('Expected the RSS source to import its feed story');
		}
		expect(importedBookmark.source_id).toBe(rssSource.id);

		const reAddCtx = createExecutionContext();
		const reAddResponse = await worker.fetch(new Request('http://example.com/sources', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				identifier: 'https://feeds.example.com/root.xml',
				kind: 'rss',
				name: 'Root Feed Restored',
			}),
		}), env, reAddCtx);
		await waitOnExecutionContext(reAddCtx);

		expect(reAddResponse.status).toBe(201);
		const reactivatedSource = await reAddResponse.json() as any;
		expect(reactivatedSource.id).toBe(rssSource.id);
		expect(reactivatedSource.name).toBe('Root Feed Restored');
		expect(reactivatedSource.status).toBe('active');

		const runsAfterReAdd = await env.KEEPROOT_DB.prepare(
			'SELECT COUNT(*) AS count FROM source_runs WHERE source_id = ?',
		)
			.bind(rssSource.id)
			.first<{ count: number }>();
		expect(runsAfterReAdd?.count).toBe((runsBeforeReAdd?.count ?? 0) + 1);

		const restoredBookmark = await env.KEEPROOT_DB.prepare(
			'SELECT source_id FROM bookmarks WHERE id = ? LIMIT 1',
		)
			.bind(importedBookmark.id)
			.first<{ source_id: string | null }>();
		expect(restoredBookmark?.source_id).toBe(rssSource.id);

		const contentCtx = createExecutionContext();
		const contentResponse = await worker.fetch(new Request(`http://example.com/bookmarks/${importedBookmark.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		}), env, contentCtx);
		await waitOnExecutionContext(contentCtx);

		expect(contentResponse.status).toBe(200);
		const restoredContent = await contentResponse.json() as any;
		expect(restoredContent.markdownData).toContain('Second complete paragraph from the source.');
		expect(restoredContent.markdownData).not.toBe('Two-line teaser only.');
	});

	it('validates REST source creation for feature-gated email and X bridge requirements', async () => {
		const emailCtx = createExecutionContext();
		const emailResponse = await worker.fetch(new Request('http://example.com/sources', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				identifier: 'weekly-digest',
				kind: 'email',
			}),
		}), env, emailCtx);
		await waitOnExecutionContext(emailCtx);

		expect(emailResponse.status).toBe(400);
		expect(await emailResponse.json()).toEqual({
			error: 'Email sources require MCP_EMAIL_DOMAIN to be configured',
		});

		const xCtx = createExecutionContext();
		const xResponse = await worker.fetch(new Request('http://example.com/sources', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				identifier: 'https://x.com/keeproot',
				kind: 'x',
			}),
		}), env, xCtx);
		await waitOnExecutionContext(xCtx);

		expect(xResponse.status).toBe(400);
		expect(await xResponse.json()).toEqual({
			error: 'X sources require an operator-provided RSS bridge URL',
		});

		const privateRssCtx = createExecutionContext();
		const privateRssResponse = await worker.fetch(new Request('http://example.com/sources', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				identifier: 'http://127.0.0.1/feed.xml',
				kind: 'rss',
			}),
		}), env, privateRssCtx);
		await waitOnExecutionContext(privateRssCtx);

		expect(privateRssResponse.status).toBe(400);
		expect(await privateRssResponse.json()).toEqual({
			error: 'Source URL must not point to local, private, or reserved network addresses',
		});

		const nonFeedFetch = mockTextFetch({
			'https://insideorchard.com/': {
				body: '<!doctype html><html><body>Ordinary website</body></html>',
				contentType: 'text/html; charset=utf-8',
			},
		});
		const nonFeedCtx = createExecutionContext();
		const nonFeedResponse = await worker.fetch(new Request('http://example.com/sources', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				identifier: 'https://insideorchard.com/',
				kind: 'rss',
			}),
		}), env, nonFeedCtx);
		await waitOnExecutionContext(nonFeedCtx);
		nonFeedFetch.mockRestore();

		expect(nonFeedResponse.status).toBe(400);
		expect(await nonFeedResponse.json()).toEqual({
			error: 'Source URL did not return an RSS or Atom feed',
		});
		const sourceCount = await env.KEEPROOT_DB.prepare(
			'SELECT COUNT(*) AS count FROM sources WHERE user_id = ?',
		).bind(TEST_USER_ID).first<{ count: number }>();
		expect(sourceCount?.count).toBe(0);
	});

	it('responds with 400 Bad Request if bookmark content is missing', async () => {
		const ctx = createExecutionContext();
		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/missing-content',
				title: 'Missing Content',
			}),
		});

		const response = await worker.fetch(createReq, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Missing bookmark content' });
	});

	it('rejects POST /bookmarks with an unsafe bookmark URL', async () => {
		const ctx = createExecutionContext();
		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				markdownData: '# Unsafe',
				title: 'Unsafe Bookmark',
				url: 'http://127.0.0.1/admin',
			}),
		});

		const response = await worker.fetch(createReq, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Bookmark URL must use a safe http or https URL' });
	});

	it('successfully creates a bookmark via POST /bookmarks', async () => {
		const ctx = createExecutionContext();
		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/success',
				title: 'Success Bookmark',
				markdownData: '# Success Content',
			}),
		});

		const response = await worker.fetch(createReq, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(201);
		const data = (await response.json()) as any;
		expect(data.id).toBeDefined();
		expect(data.message).toBe('Saved successfully');
		expect(data.metadata.url).toBe('https://example.com/success');
		expect(data.metadata.title).toBe('Success Bookmark');
	});

	it('handles bookmark CRUD operations with D1 metadata and R2 content', async () => {
		const ctx = createExecutionContext();

		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com',
				title: 'Example',
				markdownData: '# Example Content',
			}),
		});
		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;
		expect(createData.message).toBe('Saved successfully');
		expect(createData.inboxEntryId).toBeDefined();
		expect(createData.metadata.contentRef).toMatch(/^content\//);
		const id = createData.id;
		expect(id).toBeDefined();

		const contentObjects = await env.KEEPROOT_CONTENT.list();
		expect(contentObjects.objects.some((object) => object.key === createData.metadata.contentRef)).toBe(true);

		const listReq = new Request('http://example.com/bookmarks', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const listRes = await worker.fetch(listReq, env, ctx);
		expect(listRes.status).toBe(200);
		const listData = (await listRes.json()) as any;
		expect(listData.keys.some((key: any) => key.name === id)).toBe(true);
		expect(listData.keys.find((key: any) => key.id === id)?.metadata.bodyText).toBe('Example Content');

		const getReq = new Request(`http://example.com/bookmarks/${id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any;
		expect(getData.markdownData).toBe('# Example Content');
		expect(getData.metadata.title).toBe('Example');
		expect(getData.metadata.url).toBe('https://example.com/');

		const delReq = new Request(`http://example.com/bookmarks/${id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const delRes = await worker.fetch(delReq, env, ctx);
		expect(delRes.status).toBe(200);
		expect(await delRes.json()).toEqual({ message: 'Deleted successfully' });

		const getReq2 = new Request(`http://example.com/bookmarks/${id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes2 = await worker.fetch(getReq2, env, ctx);
		expect(getRes2.status).toBe(404);

		await waitOnExecutionContext(ctx);
	});

	it('stores images to R2 when markdown contains image URLs', async () => {
		const ctx = createExecutionContext();
		const dataUrl = `data:image/png;base64,${TINY_PNG_BASE64}`;
		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/with-image',
				title: 'Image Bookmark',
				markdownData: `# Image Bookmark\n\n![inline](${dataUrl})`,
			}),
		});

		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;

		const getReq = new Request(`http://example.com/bookmarks/${createData.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any;
		expect(Array.isArray(getData.metadata.images)).toBe(true);
		expect(getData.metadata.images.length).toBeGreaterThan(0);
		expect(getData.markdownData).toMatch(/^# Image Bookmark\s+!\[inline\]\(\/images\/[a-f0-9]{64}\)$/);

		const imageObjects = await env.KEEPROOT_CONTENT.list({ prefix: 'images/' });
		expect(imageObjects.objects.length).toBeGreaterThan(0);
		const imagePath = getData.markdownData.match(/\((\/images\/[a-f0-9]{64})\)/)?.[1];
		expect(imagePath).toBeDefined();
		if (!imagePath) {
			throw new Error('Expected a rewritten image path');
		}

		const unauthorizedContext = createExecutionContext();
		const unauthorizedResponse = await worker.fetch(new Request(`http://example.com${imagePath}`), env, unauthorizedContext);
		await waitOnExecutionContext(unauthorizedContext);
		expect(unauthorizedResponse.status).toBe(401);

		const ownerContext = createExecutionContext();
		const ownerResponse = await worker.fetch(new Request(`http://example.com${imagePath}`, {
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				Origin: 'http://example.com',
			},
		}), env, ownerContext);
		await waitOnExecutionContext(ownerContext);
		expect(ownerResponse.status).toBe(200);
		expect(ownerResponse.headers.get('Cache-Control')).toBe('no-store');
		expect(ownerResponse.headers.get('Content-Type')).toBe('image/png');
		expect(ownerResponse.headers.get('Vary')).toBe('Authorization, Origin');

		await seedUser('other-user-id', 'other-user');
		const otherKey = await createApiKey(env, {
			userId: 'other-user-id',
			username: 'other-user',
		}, 'Other user');
		const otherContext = createExecutionContext();
		const otherResponse = await worker.fetch(new Request(`http://example.com${imagePath}`, {
			headers: { Authorization: `Bearer ${otherKey.secret}` },
		}), env, otherContext);
		await waitOnExecutionContext(otherContext);
		expect(otherResponse.status).toBe(404);

		await waitOnExecutionContext(ctx);
	});

	it('rewrites absolute markdown image URLs to local image storage', async () => {
		const ctx = createExecutionContext();
		mockImageFetch({
			'https://cdn.example.com/article/hero.png': {},
		});

		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/articles/absolute-image',
				title: 'Absolute Image Bookmark',
				markdownData: '# Article\n\n![hero](https://cdn.example.com/article/hero.png)',
			}),
		});

		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;

		const getReq = new Request(`http://example.com/bookmarks/${createData.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any;
		expect(getData.markdownData).toMatch(/^# Article\s+!\[hero\]\(\/images\/[a-f0-9]{64}\)$/);

		await waitOnExecutionContext(ctx);
	});

	it('does not fetch unsafe markdown image URLs during server-side hydration', async () => {
		const ctx = createExecutionContext();
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/articles/private-image',
				title: 'Unsafe Image Bookmark',
				markdownData: '# Article\n\n![private](http://127.0.0.1/admin.png)',
			}),
		});

		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;
		expect(fetchSpy).not.toHaveBeenCalledWith('http://127.0.0.1/admin.png');

		const getReq = new Request(`http://example.com/bookmarks/${createData.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any;
		expect(getData.metadata.images ?? []).toEqual([]);
		expect(getData.markdownData).toContain('http://127.0.0.1/admin.png');

		await waitOnExecutionContext(ctx);
	});

	it('rewrites relative markdown image URLs using the page URL as the fetch base', async () => {
		const ctx = createExecutionContext();
		const fetchSpy = mockImageFetch({
			'https://example.com/images/hero.png': {},
		});

		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/articles/post',
				title: 'Relative Image Bookmark',
				markdownData: '# Relative\n\n![hero](../images/hero.png)',
			}),
		});

		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;
		expect(fetchSpy).toHaveBeenCalledWith('https://example.com/images/hero.png', { redirect: 'manual' });

		const getReq = new Request(`http://example.com/bookmarks/${createData.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any;
		expect(getData.markdownData).toMatch(/^# Relative\s+!\[hero\]\(\/images\/[a-f0-9]{64}\)$/);

		await waitOnExecutionContext(ctx);
	});

	it('preserves markdown image titles when rewriting stored image URLs', async () => {
		const ctx = createExecutionContext();
		mockImageFetch({
			'https://cdn.example.com/article/hero.png': {},
		});

		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/articles/titled-image',
				title: 'Titled Image Bookmark',
				markdownData: '# Titled\n\n![hero](https://cdn.example.com/article/hero.png "Lead image")',
			}),
		});

		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;

		const getReq = new Request(`http://example.com/bookmarks/${createData.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any;
		expect(getData.markdownData).toMatch(/^# Titled\s+!\[hero\]\(\/images\/[a-f0-9]{64} "Lead image"\)$/);

		await waitOnExecutionContext(ctx);
	});

	it('deduplicates bookmarks by canonical URL hash and updates stored content', async () => {
		const ctx = createExecutionContext();
		const baseHeaders = {
			Authorization: `Bearer ${API_KEY}`,
			'Content-Type': 'application/json',
		};

		const firstCreateReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: baseHeaders,
			body: JSON.stringify({
				url: 'https://example.com/article/?utm_source=test',
				title: 'First Title',
				markdownData: '# First Content',
			}),
		});
		const firstCreateRes = await worker.fetch(firstCreateReq, env, ctx);
		const firstCreateData = (await firstCreateRes.json()) as any;

		const secondCreateReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: baseHeaders,
			body: JSON.stringify({
				url: 'https://example.com/article',
				title: 'Updated Title',
				markdownData: '# Updated Content',
			}),
		});
		const secondCreateRes = await worker.fetch(secondCreateReq, env, ctx);
		const secondCreateData = (await secondCreateRes.json()) as any;

		expect(secondCreateData.id).toBe(firstCreateData.id);

		const listReq = new Request('http://example.com/bookmarks', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const listRes = await worker.fetch(listReq, env, ctx);
		const listData = (await listRes.json()) as any;
		expect(listData.keys).toHaveLength(1);
		expect(listData.keys[0].metadata.title).toBe('Updated Title');

		const getReq = new Request(`http://example.com/bookmarks/${firstCreateData.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		const getData = (await getRes.json()) as any;
		expect(getData.markdownData).toBe('# Updated Content');
		expect(getData.metadata.canonicalUrl).toBe('https://example.com/article');

		await waitOnExecutionContext(ctx);
	});

	it('normalizes malformed bookmark routes', async () => {
		const ctx = createExecutionContext();

		const createReq = new Request('http://example.com//bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/normalized',
				title: 'Normalized Route',
				markdownData: '# Normalized Content',
			}),
		});
		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;
		expect(createData.id).toBeDefined();

		const listReq = new Request('http://example.com//bookmarks', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const listRes = await worker.fetch(listReq, env, ctx);
		expect(listRes.status).toBe(200);
		const listData = (await listRes.json()) as any;
		expect(listData.keys.some((key: any) => key.name === createData.id)).toBe(true);

		const duplicatePrefixReq = new Request('http://example.com/bookmarks/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/duplicate-prefix',
				title: 'Duplicated Prefix',
				markdownData: '# Duplicated Prefix Content',
			}),
		});
		const duplicatePrefixRes = await worker.fetch(duplicatePrefixReq, env, ctx);
		expect(duplicatePrefixRes.status).toBe(201);
		const duplicatePrefixData = (await duplicatePrefixRes.json()) as any;

		const getDuplicatePrefixReq = new Request(`http://example.com/bookmarks/bookmarks/${duplicatePrefixData.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getDuplicatePrefixRes = await worker.fetch(getDuplicatePrefixReq, env, ctx);
		expect(getDuplicatePrefixRes.status).toBe(200);
		const getDuplicatePrefixData = (await getDuplicatePrefixRes.json()) as any;
		expect(getDuplicatePrefixData.markdownData).toBe('# Duplicated Prefix Content');

		const notFoundReq = new Request('http://example.com/not-a-route', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const notFoundRes = await worker.fetch(notFoundReq, env, ctx);
		expect(notFoundRes.status).toBe(404);

		await waitOnExecutionContext(ctx);
	});

	it('handles API key CRUD operations', async () => {
		const ctx = createExecutionContext();

		const createReq = new Request('http://example.com/api-keys', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ name: 'My Extension' }),
		});
		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;
		expect(createData.secret).toBeDefined();
		expect(createData.metadata.name).toBe('My Extension');
		expect(createData.metadata.id).toBeDefined();
		expect(Date.parse(createData.metadata.expiresAt)).toBeGreaterThan(Date.parse(createData.metadata.createdAt));

		const listReq = new Request('http://example.com/api-keys', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const listRes = await worker.fetch(listReq, env, ctx);
		expect(listRes.status).toBe(200);
		const listData = (await listRes.json()) as any;
		expect(listData.keys.some((key: any) => key.id === createData.metadata.id)).toBe(true);

		const testReq = new Request('http://example.com/bookmarks', {
			headers: { Authorization: `Bearer ${createData.secret}` },
		});
		const testRes = await worker.fetch(testReq, env, ctx);
		expect(testRes.status).toBe(200);

		await env.KEEPROOT_DB.prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?')
			.bind('2000-01-01T00:00:00.000Z', createData.metadata.id)
			.run();
		const expiredReq = new Request('http://example.com/bookmarks', {
			headers: { Authorization: `Bearer ${createData.secret}` },
		});
		const expiredRes = await worker.fetch(expiredReq, env, ctx);
		expect(expiredRes.status).toBe(401);

		const expiredListRes = await worker.fetch(listReq, env, ctx);
		const expiredListData = (await expiredListRes.json()) as any;
		expect(expiredListData.keys.find((key: any) => key.id === createData.metadata.id)).toMatchObject({
			expired: true,
			expiresAt: '2000-01-01T00:00:00.000Z',
		});

		const delReq = new Request(`http://example.com/api-keys/${createData.metadata.id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const delRes = await worker.fetch(delReq, env, ctx);
		expect(delRes.status).toBe(200);
		expect(await delRes.json()).toEqual({ message: 'Deleted successfully' });

		await waitOnExecutionContext(ctx);
	});

	it('clears all user data for a session-authenticated user while preserving login', async () => {
		const sessionToken = await createSession(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		});
		const list = await createList(env, TEST_USER_ID, { name: 'Reading Queue' });
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<rss><channel></channel></rss>'));
		const source = await addSource(env, {
			identifier: 'https://example.com/feed.xml',
			kind: 'rss',
			name: 'Root Feed',
			userId: TEST_USER_ID,
		});
		await createSmartList(env, TEST_USER_ID, {
			icon: 'R',
			name: 'Unread Feed',
			rules: 'feed unread',
		});
		await ensureAccountSettings(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		});
		await createApiKey(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		}, 'Dashboard Key');
		await recordToolEvent(env, {
			durationMs: 123,
			status: 'success',
			toolName: 'list_items',
			userId: TEST_USER_ID,
		});
		await saveBookmark(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		}, {
			htmlData: '<article><p>Saved content</p></article>',
			images: [{
				contentType: 'image/png',
				dataBase64: TINY_PNG_BASE64,
				sourceUrl: 'https://example.com/image.png',
			}],
			listId: list.id,
			markdownData: '# Saved content',
			sourceId: String(source.id),
			tags: ['reading', 'archive'],
			title: 'Saved article',
			url: 'https://example.com/saved-article',
		});

		const clearRes = await authedRequest('/account/data', {
			method: 'DELETE',
			token: sessionToken,
		});
		expect(clearRes.status).toBe(200);
		expect(await clearRes.json()).toEqual({ message: 'All data cleared' });

		const bookmarksRes = await authedRequest('/bookmarks', { token: sessionToken });
		expect(bookmarksRes.status).toBe(200);
		expect(await bookmarksRes.json()).toEqual({ keys: [] });

		const listsRes = await authedRequest('/lists', { token: sessionToken });
		expect(listsRes.status).toBe(200);
		expect(await listsRes.json()).toEqual({ lists: [] });

		const smartListsRes = await authedRequest('/smart-lists', { token: sessionToken });
		expect(smartListsRes.status).toBe(200);
		expect(await smartListsRes.json()).toEqual({ lists: [] });

		const sourcesRes = await authedRequest('/sources', { token: sessionToken });
		expect(sourcesRes.status).toBe(200);
		expect(await sourcesRes.json()).toEqual({ nextCursor: null, sources: [] });

		const apiKeysRes = await authedRequest('/api-keys', { token: sessionToken });
		expect(apiKeysRes.status).toBe(200);
		expect(await apiKeysRes.json()).toEqual({ keys: [] });

		const counts = await env.KEEPROOT_DB.batch([
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM users WHERE id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM api_keys WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM lists WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM smart_lists WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM sources WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM tags WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM tool_events WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM account_settings WHERE user_id = ?').bind(TEST_USER_ID),
		]) as Array<{ results: Array<{ count: number }> }>;

		expect(counts[0].results[0]?.count).toBe(1);
		expect(counts[1].results[0]?.count).toBeGreaterThan(0);
		expect(counts[2].results[0]?.count).toBe(0);
		expect(counts[3].results[0]?.count).toBe(0);
		expect(counts[4].results[0]?.count).toBe(0);
		expect(counts[5].results[0]?.count).toBe(0);
		expect(counts[6].results[0]?.count).toBe(0);
		expect(counts[7].results[0]?.count).toBe(0);
		expect(counts[8].results[0]?.count).toBe(0);
		expect(counts[9].results[0]?.count).toBe(0);
	});

	it('rejects clear all data when authenticated with an API key', async () => {
		const response = await authedRequest('/account/data', {
			method: 'DELETE',
			token: API_KEY,
		});

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'Clear all data requires a signed-in dashboard session' });
	});

	it('keeps shared R2 objects when another user still references them', async () => {
		const sessionToken = await createSession(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		});
		await seedUser('other-user-id', 'other-user');

		const firstBookmark = await saveBookmark(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		}, {
			htmlData: '<article><p>Shared content</p></article>',
			images: [{
				contentType: 'image/png',
				dataBase64: TINY_PNG_BASE64,
				sourceUrl: 'https://example.com/shared-image.png',
			}],
			markdownData: '# Shared content',
			title: 'Shared article',
			url: 'https://example.com/shared-article',
		});

		await saveBookmark(env, {
			userId: 'other-user-id',
			username: 'other-user',
		}, {
			htmlData: '<article><p>Shared content</p></article>',
			images: [{
				contentType: 'image/png',
				dataBase64: TINY_PNG_BASE64,
				sourceUrl: 'https://example.com/shared-image.png',
			}],
			markdownData: '# Shared content',
			title: 'Shared article',
			url: 'https://example.com/shared-article',
		});

		const sharedRefs = await env.KEEPROOT_DB.batch([
			env.KEEPROOT_DB.prepare(
				'SELECT r2_key, html_r2_key FROM bookmark_contents WHERE bookmark_id = ? LIMIT 1',
			).bind(firstBookmark.id),
			env.KEEPROOT_DB.prepare(
				'SELECT r2_key FROM bookmark_images WHERE bookmark_id = ? LIMIT 1',
			).bind(firstBookmark.id),
		]) as [D1Result<{ html_r2_key: string | null; r2_key: string | null }>, D1Result<{ r2_key: string | null }>];

		const contentKey = sharedRefs[0].results[0]?.r2_key;
		const htmlKey = sharedRefs[0].results[0]?.html_r2_key;
		const imageKey = sharedRefs[1].results[0]?.r2_key;
		expect(contentKey).toBeTruthy();
		expect(htmlKey).toBeTruthy();
		expect(imageKey).toBeTruthy();

		const clearRes = await authedRequest('/account/data', {
			method: 'DELETE',
			token: sessionToken,
		});
		expect(clearRes.status).toBe(200);

		const contentObject = await env.KEEPROOT_CONTENT.get(contentKey!);
		const htmlObject = await env.KEEPROOT_CONTENT.get(htmlKey!);
		const imageObject = await env.KEEPROOT_CONTENT.get(imageKey!);
		expect(contentObject).not.toBeNull();
		expect(htmlObject).not.toBeNull();
		expect(imageObject).not.toBeNull();
		await contentObject?.text();
		await htmlObject?.text();
		await imageObject?.arrayBuffer();

		const remaining = await env.KEEPROOT_DB.prepare(
			'SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ?',
		)
			.bind('other-user-id')
			.first<{ count: number }>();
		expect(remaining?.count).toBe(1);
	});

	it('bootstraps organization schema and supports list CRUD', async () => {
		const ctx = createExecutionContext();

		const createReq = new Request('http://example.com/lists', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ name: 'Reading Queue' }),
		});
		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;
		expect(createData.name).toBe('Reading Queue');
		expect(createData.id).toBeDefined();

		const listReq = new Request('http://example.com/lists', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const listRes = await worker.fetch(listReq, env, ctx);
		expect(listRes.status).toBe(200);
		const listData = (await listRes.json()) as any;
		expect(listData.lists.some((list: any) => list.id === createData.id && list.name === 'Reading Queue')).toBe(true);

		const updateReq = new Request(`http://example.com/lists/${createData.id}`, {
			method: 'PATCH',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ name: 'Updated Queue' }),
		});
		const updateRes = await worker.fetch(updateReq, env, ctx);
		expect(updateRes.status).toBe(200);

		const deleteReq = new Request(`http://example.com/lists/${createData.id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const deleteRes = await worker.fetch(deleteReq, env, ctx);
		expect(deleteRes.status).toBe(200);

		await waitOnExecutionContext(ctx);
	});

	it('supports smart-list CRUD with validated PATCH payloads', async () => {
		const ctx = createExecutionContext();

		const createReq = new Request('http://example.com/smart-lists', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ icon: 'star', name: 'Travel', rules: 'visa, schengen' }),
		});
		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;
		expect(createData.id).toBeDefined();
		expect(createData.name).toBe('Travel');
		expect(createData.rules).toBe('visa, schengen');
		expect(createData.icon).toBe('star');
		expect(createData.sortOrder).toBe(0);

		const listReq = new Request('http://example.com/smart-lists', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const listRes = await worker.fetch(listReq, env, ctx);
		expect(listRes.status).toBe(200);
		const listData = (await listRes.json()) as any;
		expect(listData.lists.some((list: any) => list.id === createData.id && list.rules === 'visa, schengen')).toBe(true);

		const invalidUpdateReq = new Request(`http://example.com/smart-lists/${createData.id}`, {
			method: 'PATCH',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ rules: '   ' }),
		});
		const invalidUpdateRes = await worker.fetch(invalidUpdateReq, env, ctx);
		expect(invalidUpdateRes.status).toBe(400);
		expect(await invalidUpdateRes.json()).toEqual({ error: 'Rules required' });

		const updateReq = new Request(`http://example.com/smart-lists/${createData.id}`, {
			method: 'PATCH',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ name: 'Travel Planning', rules: 'visa planning' }),
		});
		const updateRes = await worker.fetch(updateReq, env, ctx);
		expect(updateRes.status).toBe(200);

		const missingUpdateReq = new Request('http://example.com/smart-lists/does-not-exist', {
			method: 'PATCH',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({}),
		});
		const missingUpdateRes = await worker.fetch(missingUpdateReq, env, ctx);
		expect(missingUpdateRes.status).toBe(404);

		const deleteReq = new Request(`http://example.com/smart-lists/${createData.id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const deleteRes = await worker.fetch(deleteReq, env, ctx);
		expect(deleteRes.status).toBe(200);

		await waitOnExecutionContext(ctx);
	});

	it('serves the MCP tool surface for item workflows', async () => {
		mockTextFetch({
			'https://content.example.com/article': {
				body: `<!doctype html>
					<html lang="en">
						<head><title>Alpha Article</title></head>
						<body>
							<main>
								<h1>Alpha Article</h1>
								<p>Alpha semantic content for MCP search coverage.</p>
							</main>
						</body>
					</html>`,
				contentType: 'text/html; charset=utf-8',
			},
		});

		const toolsResponse = await mcpRequest('tools/list');
		expect(toolsResponse.response.status).toBe(200);
		const toolNames = toolsResponse.data.result.tools.map((tool: { name: string }) => tool.name);
		expect(toolNames).toEqual(expect.arrayContaining([
			'save_item',
			'search_items',
			'list_items',
			'get_item',
			'update_item',
			'whoami',
			'list_sources',
			'add_source',
			'remove_source',
			'get_stats',
			'list_inbox',
			'mark_done',
		]));
		const saveItemTool = toolsResponse.data.result.tools.find((tool: { name: string }) => tool.name === 'save_item');
		expect(saveItemTool.inputSchema.properties).toHaveProperty('render');
		expect(saveItemTool.inputSchema.properties).toHaveProperty('captureScreenshot');

		const whoAmI = await mcpCallTool('whoami');
		expect(whoAmI.payload.account.username).toBe(TEST_USERNAME);
		expect(whoAmI.payload.account.plan).toBe('self_hosted');

		const saved = await mcpCallTool('save_item', {
			notes: 'Captured via MCP',
			tags: ['Alpha', 'MCP'],
			url: 'https://content.example.com/article',
		});
		const itemId = saved.payload.id;
		expect(itemId).toBeDefined();
		expect(saved.payload.inboxEntryId).toBeDefined();

		const listed = await mcpCallTool('list_items', {
			limit: 10,
			status: 'saved',
		});
		expect(listed.payload.items).toHaveLength(1);
		expect(listed.payload.items[0].id).toBe(itemId);

		const searched = await mcpCallTool('search_items', {
			limit: 10,
			query: 'semantic alpha',
		});
		expect(searched.payload.items).toHaveLength(1);
		expect(searched.payload.items[0].id).toBe(itemId);

		const fetched = await mcpCallTool('get_item', {
			id: itemId,
			includeContent: true,
		});
		expect(fetched.payload.id).toBe(itemId);
		expect(fetched.payload.markdownData).toContain('Alpha semantic content for MCP search coverage.');

		const updated = await mcpCallTool('update_item', {
			id: itemId,
			notes: 'Updated from MCP',
			status: 'archived',
			tags: ['mcp', 'updated'],
			title: 'Alpha Article Revised',
		});
		expect(updated.payload.metadata.status).toBe('archived');
		expect(updated.payload.metadata.title).toBe('Alpha Article Revised');
		expect(updated.payload.metadata.notes).toBe('Updated from MCP');

		const inbox = await mcpCallTool('list_inbox');
		expect(inbox.payload.entries).toHaveLength(1);
		expect(inbox.payload.entries[0].item.id).toBe(itemId);

		const marked = await mcpCallTool('mark_done', {
			id: inbox.payload.entries[0].id,
		});
		expect(marked.payload.state).toBe('done');

		const stats = await mcpCallTool('get_stats');
		expect(stats.payload.items.total).toBe(1);
		expect(stats.payload.items.byStatus.archived).toBe(1);
		expect(stats.payload.inbox.pending).toBe(0);
		expect(stats.payload.ingestion).toEqual(expect.objectContaining({ health: expect.stringMatching(/green|amber|red/) }));
		expect(stats.payload.recentToolUsage.length).toBeGreaterThan(0);
	});

	it('throttles api key last_used_at writes for repeated MCP requests', async () => {
		const before = await env.KEEPROOT_DB.prepare(
			'SELECT last_used_at FROM api_keys WHERE id = ?',
		)
			.bind('test-api-key-id')
			.first<{ last_used_at: string | null }>();
		expect(before?.last_used_at ?? null).toBeNull();

		await mcpRequest('tools/list');
		const first = await env.KEEPROOT_DB.prepare(
			'SELECT last_used_at FROM api_keys WHERE id = ?',
		)
			.bind('test-api-key-id')
			.first<{ last_used_at: string | null }>();

		await mcpRequest('tools/list');
		const second = await env.KEEPROOT_DB.prepare(
			'SELECT last_used_at FROM api_keys WHERE id = ?',
		)
			.bind('test-api-key-id')
			.first<{ last_used_at: string | null }>();

		expect(first?.last_used_at).toBeTruthy();
		expect(second?.last_used_at).toBe(first?.last_used_at);
	});

	it('manages MCP sources, subscriptions, and inbox sync state', async () => {
		(env as { MCP_EMAIL_DOMAIN?: string }).MCP_EMAIL_DOMAIN = 'mail.keeproot.test';
		let feedItemUrl = 'https://feeds.example.com/posts/1?revision=1';
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url !== 'https://feeds.example.com/root.xml') {
				throw new Error(`Unexpected fetch URL: ${url}`);
			}
			return new Response(`<?xml version="1.0" encoding="UTF-8"?>
					<rss version="2.0">
						<channel>
							<title>KeepRoot Feed</title>
							<item>
								<title>Feed Story</title>
								<link>${feedItemUrl}</link>
								<guid isPermaLink="false">root-feed-story-1</guid>
								<description>Fresh story from a synced source.</description>
							</item>
						</channel>
					</rss>`, {
				headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
			});
		});

		const emailSource = await mcpCallTool('add_source', {
			identifier: 'weekly-digest',
			kind: 'email',
			name: 'Digest Inbox',
			syncNow: false,
		});
		expect(emailSource.payload.kind).toBe('email');
		expect(emailSource.payload.emailAlias).toContain('@mail.keeproot.test');

		const rssSource = await mcpCallTool('add_source', {
			identifier: 'https://feeds.example.com/root.xml',
			kind: 'rss',
			name: 'Root Feed',
		});
		const rssSourceId = rssSource.payload.id;
		expect(rssSource.payload.pollUrl).toBe('https://feeds.example.com/root.xml');

		const listed = await mcpCallTool('list_sources');
		expect(listed.payload.sources).toHaveLength(2);

		const inbox = await mcpCallTool('list_inbox');
		expect(inbox.payload.entries).toHaveLength(1);
		expect(inbox.payload.entries[0].source.id).toBe(rssSourceId);

		const statsBeforeDone = await mcpCallTool('get_stats');
		expect(statsBeforeDone.payload.sources.total).toBe(2);
		expect(statsBeforeDone.payload.sources.byKind.email).toBe(1);
		expect(statsBeforeDone.payload.sources.byKind.rss).toBe(1);
		expect(statsBeforeDone.payload.inbox.pending).toBe(1);

		await mcpCallTool('mark_done', {
			id: inbox.payload.entries[0].id,
		});

		feedItemUrl = 'https://feeds.example.com/posts/1?revision=2';
		const repeatedSync = await mcpCallTool('add_source', {
			identifier: 'https://feeds.example.com/root.xml',
			kind: 'rss',
			name: 'Root Feed',
		});
		expect(repeatedSync.payload.id).toBe(rssSourceId);

		const inboxAfterRepeatedSync = await mcpCallTool('list_inbox');
		expect(inboxAfterRepeatedSync.payload.entries).toHaveLength(0);

		const statsAfterRepeatedSync = await mcpCallTool('get_stats');
		expect(statsAfterRepeatedSync.payload.items.total).toBe(1);
		expect(statsAfterRepeatedSync.payload.inbox.pending).toBe(0);

		const removed = await mcpCallTool('remove_source', {
			id: rssSourceId,
		});
		expect(removed.payload.removed).toBe(true);

		const afterRemoval = await mcpCallTool('list_sources');
		expect(afterRemoval.payload.sources).toHaveLength(1);
		expect(afterRemoval.payload.sources[0].kind).toBe('email');
	});

	it('delegates static assets and returns 404 for missing public assets', async () => {
		const ctx = createExecutionContext();
		const homeResponse = await worker.fetch(new Request('http://example.com/'), env, ctx);
		const serviceWorkerResponse = await worker.fetch(new Request('http://example.com/sw.js'), env, ctx);
		const missingResponse = await worker.fetch(new Request('http://example.com/nonexistent'), env, ctx);
		await waitOnExecutionContext(ctx);

		expect(homeResponse.status).toBe(200);
		expect(homeResponse.headers.get('content-type')).toContain('text/html');
		expect(await homeResponse.text()).toContain('KeepRoot Dashboard');

		expect(serviceWorkerResponse.status).toBe(200);
		expect(serviceWorkerResponse.headers.get('content-type')).toContain('javascript');
		expect(await serviceWorkerResponse.text()).toContain('keeproot-v2');

		expect(missingResponse.status).toBe(404);
	});
});
