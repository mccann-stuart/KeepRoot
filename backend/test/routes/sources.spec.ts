import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleSourceRoute } from '../../src/routes/sources';
import * as storage from '../../src/storage';
import * as sourceSync from '../../src/mcp/source-sync';
import { type ProtectedRouteContext } from '../../src/http';

vi.mock('../../src/storage', () => ({
	addSource: vi.fn(),
	listSources: vi.fn(),
	removeSource: vi.fn(),
}));

vi.mock('../../src/mcp/source-sync', () => ({
	maybeQueueSourceSync: vi.fn(),
}));

describe('handleSourceRoute', () => {
	const mockEnv = {} as any;
	const mockUser = { userId: 'user-123' } as any;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	function createMockContext(method: string, pathname: string, body?: any): ProtectedRouteContext {
		const urlString = pathname.startsWith('http') ? pathname : `http://example.com${pathname}`;
		const requestUrl = new URL(urlString);
		const requestOptions: RequestInit = { method };
		if (body !== undefined) {
			requestOptions.body = JSON.stringify(body);
			requestOptions.headers = { 'Content-Type': 'application/json' };
		}

		return {
			env: mockEnv,
			authUser: mockUser,
			request: new Request(requestUrl, requestOptions),
			pathname: requestUrl.pathname,
			url: requestUrl,
			origin: 'http://example.com',
			rpID: 'example.com',
		} as unknown as ProtectedRouteContext;
	}

	describe('GET /sources', () => {
		it('should list sources without query parameters and return 200 JSON', async () => {
			const mockSources = [{ id: 'src-1' }];
			vi.mocked(storage.listSources).mockResolvedValue(mockSources as any);

			const ctx = createMockContext('GET', '/sources');
			const response = await handleSourceRoute(ctx);

			expect(storage.listSources).toHaveBeenCalledWith(mockEnv, 'user-123', {
				cursor: null,
				kind: undefined,
				limit: undefined,
				status: undefined,
			});
			expect(response).toBeDefined();
			expect(response?.status).toBe(200);
			const data = await response?.json();
			expect(data).toEqual(mockSources);
		});

		it('should list sources with parsed query parameters', async () => {
			const mockSources = [{ id: 'src-1' }];
			vi.mocked(storage.listSources).mockResolvedValue(mockSources as any);

			const ctx = createMockContext('GET', '/sources?cursor=cur&kind=web&limit=10&status=active');
			const response = await handleSourceRoute(ctx);

			expect(storage.listSources).toHaveBeenCalledWith(mockEnv, 'user-123', {
				cursor: 'cur',
				kind: 'web',
				limit: 10,
				status: 'active',
			});
			expect(response).toBeDefined();
			expect(response?.status).toBe(200);
			const data = await response?.json();
			expect(data).toEqual(mockSources);
		});

		it('should handle invalid limit by passing undefined', async () => {
			const mockSources = [{ id: 'src-1' }];
			vi.mocked(storage.listSources).mockResolvedValue(mockSources as any);

			const ctx = createMockContext('GET', '/sources?limit=abc');
			const response = await handleSourceRoute(ctx);

			expect(storage.listSources).toHaveBeenCalledWith(mockEnv, 'user-123', expect.objectContaining({
				limit: undefined,
			}));
		});
	});

	describe('POST /sources', () => {
		it('should return 400 if kind or identifier is missing', async () => {
			const ctx = createMockContext('POST', '/sources', { name: 'test' });
			const response = await handleSourceRoute(ctx);

			expect(response).toBeDefined();
			expect(response?.status).toBe(400);
			const data = await response?.json();
			expect(data).toEqual({ error: 'Kind and identifier required' });
		});

		it('should create a source and queue sync by default', async () => {
			const mockSource = { id: 'new-src' };
			vi.mocked(storage.addSource).mockResolvedValue(mockSource as any);
			vi.mocked(sourceSync.maybeQueueSourceSync).mockResolvedValue(undefined as any);

			const ctx = createMockContext('POST', '/sources', {
				kind: 'web',
				identifier: 'id-1',
				bridgeUrl: 'http://test',
				config: { a: 1 },
			});
			const response = await handleSourceRoute(ctx);

			expect(storage.addSource).toHaveBeenCalledWith(mockEnv, {
				config: { a: 1, bridgeUrl: 'http://test' },
				identifier: 'id-1',
				kind: 'web',
				name: undefined,
				userId: 'user-123',
			});
			expect(sourceSync.maybeQueueSourceSync).toHaveBeenCalledWith(mockEnv, {
				id: 'new-src',
				userId: 'user-123',
			});

			expect(response).toBeDefined();
			expect(response?.status).toBe(201);
			const data = await response?.json();
			expect(data).toEqual(mockSource);
		});

		it('should not queue sync if syncNow is false', async () => {
			const mockSource = { id: 'new-src' };
			vi.mocked(storage.addSource).mockResolvedValue(mockSource as any);

			const ctx = createMockContext('POST', '/sources', {
				kind: 'web',
				identifier: 'id-1',
				syncNow: false,
			});
			const response = await handleSourceRoute(ctx);

			expect(storage.addSource).toHaveBeenCalled();
			expect(sourceSync.maybeQueueSourceSync).not.toHaveBeenCalled();

			expect(response).toBeDefined();
			expect(response?.status).toBe(201);
		});

		it('should return 400 for ValidationError', async () => {
			const error = new Error('Bad config');
			error.name = 'ValidationError';
			vi.mocked(storage.addSource).mockRejectedValue(error);

			const ctx = createMockContext('POST', '/sources', { kind: 'web', identifier: 'id-1' });
			const response = await handleSourceRoute(ctx);

			expect(response).toBeDefined();
			expect(response?.status).toBe(400);
			const data = await response?.json();
			expect(data).toEqual({ error: 'Bad config' });
		});

		it('should return 500 for generic error', async () => {
			const error = new Error('DB error');
			vi.mocked(storage.addSource).mockRejectedValue(error);

			const ctx = createMockContext('POST', '/sources', { kind: 'web', identifier: 'id-1' });

			// suppress console.error
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const response = await handleSourceRoute(ctx);
			consoleSpy.mockRestore();

			expect(response).toBeDefined();
			expect(response?.status).toBe(500);
			const data = await response?.json();
			expect(data).toEqual({ error: 'Failed to create source' });
		});
	});

	describe('DELETE /sources/:id', () => {
		it('should return 400 if ID is missing', async () => {
			const ctx = createMockContext('DELETE', '/sources/');
			const response = await handleSourceRoute(ctx);

			expect(response).toBeDefined();
			expect(response?.status).toBe(400);
			const data = await response?.json();
			expect(data).toEqual({ error: 'Missing ID' });
			expect(storage.removeSource).not.toHaveBeenCalled();
		});

		it('should return 404 if source is not found', async () => {
			vi.mocked(storage.removeSource).mockResolvedValue(false);

			const ctx = createMockContext('DELETE', '/sources/invalid');
			const response = await handleSourceRoute(ctx);

			expect(storage.removeSource).toHaveBeenCalledWith(mockEnv, 'user-123', 'invalid');
			expect(response).toBeDefined();
			expect(response?.status).toBe(404);
			const data = await response?.json();
			expect(data).toEqual({ error: 'Not found' });
		});

		it('should return 200 on successful deletion', async () => {
			vi.mocked(storage.removeSource).mockResolvedValue(true);

			const ctx = createMockContext('DELETE', '/sources/valid');
			const response = await handleSourceRoute(ctx);

			expect(storage.removeSource).toHaveBeenCalledWith(mockEnv, 'user-123', 'valid');
			expect(response).toBeDefined();
			expect(response?.status).toBe(200);
			const data = await response?.json();
			expect(data).toEqual({ removed: true });
		});
	});

	describe('unmatched routes', () => {
		it('should return undefined for other HTTP methods', async () => {
			const ctx = createMockContext('PUT', '/sources');
			const response = await handleSourceRoute(ctx);

			expect(response).toBeUndefined();
		});

		it('should return undefined for other paths', async () => {
			const ctx = createMockContext('GET', '/other');
			const response = await handleSourceRoute(ctx);

			expect(response).toBeUndefined();
		});
	});
});
