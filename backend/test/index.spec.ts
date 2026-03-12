import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

describe('KeepRoot Worker', () => {
	const SECRET = 'test-secret';
	const authEnv = { ...env, API_SECRET: SECRET };

	it('responds with 401 Unauthorized if no token provided', async () => {
		const request = new Request('http://example.com/bookmarks');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, authEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Unauthorized' });
	});

	it('responds with 401 if API_SECRET is not configured', async () => {
		const request = new Request('http://example.com/bookmarks', {
			headers: { 'Authorization': `Bearer ${SECRET}` },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, { ...env, API_SECRET: undefined } as any, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Worker API_SECRET is not configured. Setup required.', setupRequired: true });
	});

	it('responds with 200 and CORS headers for OPTIONS request', async () => {
		const request = new Request('http://example.com/bookmarks', {
			method: 'OPTIONS',
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, authEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
	});

	it('handles bookmark CRUD operations', async () => {
		const ctx = createExecutionContext();

		// 1. Create a bookmark
		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${SECRET}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com',
				title: 'Example',
				markdownData: '# Example Content',
			}),
		});
		const createRes = await worker.fetch(createReq, authEnv, ctx);
		expect(createRes.status).toBe(200);
		const createData = (await createRes.json()) as any;
		expect(createData.message).toBe('Saved successfully');
		const id = createData.id;
		expect(id).toBeDefined();

		// 2. List bookmarks
		const listReq = new Request('http://example.com/bookmarks', {
			headers: { Authorization: `Bearer ${SECRET}` },
		});
		const listRes = await worker.fetch(listReq, authEnv, ctx);
		expect(listRes.status).toBe(200);
		const listData = (await listRes.json()) as any;
		expect(listData.keys.some((k: any) => k.name === id)).toBe(true);

		// 3. Get bookmark
		const getReq = new Request(`http://example.com/bookmarks/${id}`, {
			headers: { Authorization: `Bearer ${SECRET}` },
		});
		const getRes = await worker.fetch(getReq, authEnv, ctx);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any;
		expect(getData.markdownData).toBe('# Example Content');
		expect(getData.metadata.title).toBe('Example');

		// 4. Delete bookmark
		const delReq = new Request(`http://example.com/bookmarks/${id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${SECRET}` },
		});
		const delRes = await worker.fetch(delReq, authEnv, ctx);
		expect(delRes.status).toBe(200);
		expect(await delRes.json()).toEqual({ message: 'Deleted successfully' });

		// 5. Verify deleted
		const getReq2 = new Request(`http://example.com/bookmarks/${id}`, {
			headers: { Authorization: `Bearer ${SECRET}` },
		});
		const getRes2 = await worker.fetch(getReq2, authEnv, ctx);
		expect(getRes2.status).toBe(404);

		await waitOnExecutionContext(ctx);
	});
});
