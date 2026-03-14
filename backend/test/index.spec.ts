import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';

describe('KeepRoot Worker', () => {
	const API_KEY = 'test-api-key-12345';

	// Pre-seed KV with an API key before each test
	beforeEach(async () => {
		await env.KEEPROOT_STORE.put(
			`apikey:${API_KEY}`,
			JSON.stringify({ userId: 'test-user-id', username: 'testuser' }),
			{ metadata: { userId: 'test-user-id', username: 'testuser', name: 'Test Key', createdAt: new Date().toISOString() } }
		);
	});

	it('responds with 401 Unauthorized if no token provided', async () => {
		const request = new Request('http://example.com/bookmarks');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Unauthorized' });
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
			headers: { 'Authorization': 'Bearer invalid-token' },
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
		expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
	});

	it('authenticates with a valid API key', async () => {
		const request = new Request('http://example.com/bookmarks', {
			headers: { 'Authorization': `Bearer ${API_KEY}` },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
	});

	it('handles bookmark CRUD operations', async () => {
		const ctx = createExecutionContext();

		// 1. Create a bookmark
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
		const id = createData.id;
		expect(id).toBeDefined();

		// 2. List bookmarks
		const listReq = new Request('http://example.com/bookmarks', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const listRes = await worker.fetch(listReq, env, ctx);
		expect(listRes.status).toBe(200);
		const listData = (await listRes.json()) as any;
		expect(listData.keys.some((k: any) => k.name === id)).toBe(true);

		// 3. Get bookmark
		const getReq = new Request(`http://example.com/bookmarks/${id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any;
		expect(getData.markdownData).toBe('# Example Content');
		expect(getData.metadata.title).toBe('Example');

		// 4. Delete bookmark
		const delReq = new Request(`http://example.com/bookmarks/${id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const delRes = await worker.fetch(delReq, env, ctx);
		expect(delRes.status).toBe(200);
		expect(await delRes.json()).toEqual({ message: 'Deleted successfully' });

		// 5. Verify deleted
		const getReq2 = new Request(`http://example.com/bookmarks/${id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes2 = await worker.fetch(getReq2, env, ctx);
		expect(getRes2.status).toBe(404);

		await waitOnExecutionContext(ctx);
	});

	it('handles API key CRUD operations', async () => {
		const ctx = createExecutionContext();

		// 1. Create a new API key
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

		// 2. List API keys
		const listReq = new Request('http://example.com/api-keys', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const listRes = await worker.fetch(listReq, env, ctx);
		expect(listRes.status).toBe(200);

		// 3. The new key should be usable for auth
		const testReq = new Request('http://example.com/bookmarks', {
			headers: { Authorization: `Bearer ${createData.secret}` },
		});
		const testRes = await worker.fetch(testReq, env, ctx);
		expect(testRes.status).toBe(200);

		// 4. Delete the new API key
		const delReq = new Request(`http://example.com/api-keys/${createData.secret}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const delRes = await worker.fetch(delReq, env, ctx);
		expect(delRes.status).toBe(200);

		await waitOnExecutionContext(ctx);
	});
});
