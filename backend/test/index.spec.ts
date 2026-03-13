import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { hashToken } from '../src/storage';
import initialSchemaSql from '../migrations/0001_initial.sql?raw';

const API_KEY = 'test-api-key-12345';
const TEST_USER_ID = 'test-user-id';
const TEST_USERNAME = 'testuser';
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgQJ8i1QAAAAASUVORK5CYII=';

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

async function execStatements(sql: string): Promise<void> {
	const statements = sql
		.split(/;\s*\n/g)
		.map((statement) => statement.trim())
		.filter(Boolean);

	for (const statement of statements) {
		await env.KEEPROOT_DB.exec(statement.replace(/\s+/g, ' ').trim());
	}
}

async function tryExec(sql: string): Promise<void> {
	try {
		await env.KEEPROOT_DB.exec(sql.replace(/\s+/g, ' ').trim());
	} catch {
		// Some organization/MCP tables are created lazily during requests.
	}
}

async function resetDatabase(): Promise<void> {
	await execStatements(initialSchemaSql);
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
		`INSERT INTO api_keys (id, secret_hash, user_id, username, name, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			'test-api-key-id',
			await hashToken(API_KEY),
			TEST_USER_ID,
			TEST_USERNAME,
			'Test Key',
			createdAt,
		)
		.run();
}

async function mcpRequest(method: string, params: Record<string, unknown> = {}): Promise<{ data: any; response: Response }> {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request('http://example.com/mcp', {
		method: 'POST',
		headers: {
			Accept: 'application/json, text/event-stream',
			Authorization: `Bearer ${API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			id: crypto.randomUUID(),
			jsonrpc: '2.0',
			method,
			params,
		}),
	}), env, ctx);
	const data = (await response.json()) as any;
	await waitOnExecutionContext(ctx);
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
		delete (env as { INGEST_QUEUE?: unknown }).INGEST_QUEUE;
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

	it('responds with 200 and CORS headers for OPTIONS request', async () => {
		const request = new Request('http://example.com/bookmarks', {
			method: 'OPTIONS',
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PATCH, DELETE, OPTIONS');
		expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization');

		const text = await response.text();
		expect(text).toBe('');
	});

	it('authenticates with a valid API key', async () => {
		const request = new Request('http://example.com/bookmarks', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
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
		expect(fetchSpy).toHaveBeenCalledWith('https://example.com/images/hero.png');

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

		const delReq = new Request(`http://example.com/api-keys/${createData.metadata.id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const delRes = await worker.fetch(delReq, env, ctx);
		expect(delRes.status).toBe(200);
		expect(await delRes.json()).toEqual({ message: 'Deleted successfully' });

		await waitOnExecutionContext(ctx);
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
		expect(stats.payload.recentToolUsage.length).toBeGreaterThan(0);
	});

	it('manages MCP sources, subscriptions, and inbox sync state', async () => {
		(env as { MCP_EMAIL_DOMAIN?: string }).MCP_EMAIL_DOMAIN = 'mail.keeproot.test';
		mockTextFetch({
			'https://feeds.example.com/root.xml': {
				body: `<?xml version="1.0" encoding="UTF-8"?>
					<rss version="2.0">
						<channel>
							<title>KeepRoot Feed</title>
							<item>
								<title>Feed Story</title>
								<link>https://feeds.example.com/posts/1</link>
								<description>Fresh story from a synced source.</description>
							</item>
						</channel>
					</rss>`,
				contentType: 'application/rss+xml; charset=utf-8',
			},
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
