import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { hashToken } from '../src/storage';
import initialSchemaSql from '../migrations/0001_initial.sql?raw';

const API_KEY = 'test-api-key-12345';
const TEST_USER_ID = 'test-user-id';
const TEST_USERNAME = 'testuser';

async function execStatements(sql: string): Promise<void> {
	const statements = sql
		.split(/;\s*\n/g)
		.map((statement) => statement.trim())
		.filter(Boolean);

	for (const statement of statements) {
		await env.KEEPROOT_DB.exec(statement.replace(/\s+/g, ' ').trim());
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

describe('KeepRoot Worker', () => {
	beforeEach(async () => {
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
		expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS');
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
		expect(createRes.status).toBe(200);
		const createData = (await createRes.json()) as any;
		expect(createData.message).toBe('Saved successfully');
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
		const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgQJ8i1QAAAAASUVORK5CYII=';
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
		expect(createRes.status).toBe(200);
		const createData = (await createRes.json()) as any;

		const getReq = new Request(`http://example.com/bookmarks/${createData.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any;
		expect(Array.isArray(getData.metadata.images)).toBe(true);
		expect(getData.metadata.images.length).toBeGreaterThan(0);

		const imageObjects = await env.KEEPROOT_CONTENT.list({ prefix: 'images/' });
		expect(imageObjects.objects.length).toBeGreaterThan(0);

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
		expect(createRes.status).toBe(200);
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
		expect(duplicatePrefixRes.status).toBe(200);
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
		expect(await notFoundRes.json()).toEqual({ error: 'Not found' });

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
		expect(createRes.status).toBe(200);
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

	it('responds with 404 for unknown routes', async () => {
		const request = new Request('http://example.com/nonexistent', {
			headers: { 'Authorization': `Bearer ${API_KEY}` },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: 'Not found' });
	});
});
