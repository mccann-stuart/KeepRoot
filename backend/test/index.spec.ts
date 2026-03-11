import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker from '../src/index';

describe('KeepRoot Bookmark API', () => {
	const API_SECRET = 'test-secret';

	beforeAll(() => {
		// Set the API_SECRET in the environment for tests
		(env as any).API_SECRET = API_SECRET;
	});

	it('should return 401 Unauthorized if Authorization header is missing', async () => {
		const request = new Request('http://example.com/bookmarks');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		const body: any = await response.json();
		expect(body.error).toBe('Unauthorized');
	});

	it('should return 400 Missing ID when GET /bookmarks/ is called without an ID', async () => {
		const request = new Request('http://example.com/bookmarks/', {
			headers: {
				'Authorization': `Bearer ${API_SECRET}`
			}
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		const body: any = await response.json();
		expect(body.error).toBe('Missing ID');
	});

	it('should return 400 Missing ID when DELETE /bookmarks/ is called without an ID', async () => {
		const request = new Request('http://example.com/bookmarks/', {
			method: 'DELETE',
			headers: {
				'Authorization': `Bearer ${API_SECRET}`
			}
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		const body: any = await response.json();
		expect(body.error).toBe('Missing ID');
	});
});
