import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleApiKeyRoute } from '../../src/routes/api-keys';
import * as storage from '../../src/storage';
import { type ProtectedRouteContext } from '../../src/http';

vi.mock('../../src/storage', () => ({
	createApiKey: vi.fn(),
	deleteApiKey: vi.fn(),
	listApiKeys: vi.fn(),
}));

describe('handleApiKeyRoute', () => {
	const mockEnv = {} as any;
	const mockUser = { userId: 'user-123' } as any;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	function createMockContext(method: string, pathname: string, body?: any): ProtectedRouteContext {
		const requestUrl = new URL(`http://example.com${pathname}`);
		const requestOptions: RequestInit = { method };
		if (body !== undefined) {
			requestOptions.body = JSON.stringify(body);
			requestOptions.headers = { 'Content-Type': 'application/json' };
		}

		return {
			env: mockEnv,
			authUser: mockUser,
			request: new Request(requestUrl, requestOptions),
			pathname,
			url: requestUrl,
			origin: 'http://example.com',
			rpID: 'example.com',
		} as unknown as ProtectedRouteContext;
	}

	describe('GET /api-keys', () => {
		it('should list API keys and return 200 JSON response', async () => {
			const mockKeys = [{ id: 'key-1', name: 'Key 1' }];
			vi.mocked(storage.listApiKeys).mockResolvedValue(mockKeys as any);

			const ctx = createMockContext('GET', '/api-keys');
			const response = await handleApiKeyRoute(ctx);

			expect(storage.listApiKeys).toHaveBeenCalledWith(mockEnv, 'user-123');
			expect(response).toBeDefined();
			expect(response?.status).toBe(200);
			const data = await response?.json();
			expect(data).toEqual({ keys: mockKeys });
		});
	});

	describe('POST /api-keys', () => {
		it('should create an API key with a provided name', async () => {
			const mockCreated = { metadata: { id: 'key-2', name: 'My Key' }, secret: 'secret-xyz' };
			vi.mocked(storage.createApiKey).mockResolvedValue(mockCreated as any);

			const ctx = createMockContext('POST', '/api-keys', { name: '  My Key  ' });
			const response = await handleApiKeyRoute(ctx);

			expect(storage.createApiKey).toHaveBeenCalledWith(mockEnv, mockUser, 'My Key');
			expect(response).toBeDefined();
			expect(response?.status).toBe(201);
			const data = await response?.json();
			expect(data).toEqual(mockCreated);
		});

		it('should create an API key with a default name if not provided', async () => {
			const mockCreated = { metadata: { id: 'key-2', name: 'Unnamed Key' }, secret: 'secret-xyz' };
			vi.mocked(storage.createApiKey).mockResolvedValue(mockCreated as any);

			const ctx = createMockContext('POST', '/api-keys', {});
			const response = await handleApiKeyRoute(ctx);

			expect(storage.createApiKey).toHaveBeenCalledWith(mockEnv, mockUser, 'Unnamed Key');
			expect(response).toBeDefined();
			expect(response?.status).toBe(201);
			const data = await response?.json();
			expect(data).toEqual(mockCreated);
		});
	});

	describe('DELETE /api-keys/:id', () => {
		it('should return 400 if ID is missing', async () => {
			const ctx = createMockContext('DELETE', '/api-keys/');
			const response = await handleApiKeyRoute(ctx);

			expect(response).toBeDefined();
			expect(response?.status).toBe(400);
			const data = await response?.json();
			expect(data).toEqual({ error: 'Missing ID' });
			expect(storage.deleteApiKey).not.toHaveBeenCalled();
		});

		it('should return 404 if key is not found or unauthorized', async () => {
			vi.mocked(storage.deleteApiKey).mockResolvedValue(false);

			const ctx = createMockContext('DELETE', '/api-keys/key-to-delete');
			const response = await handleApiKeyRoute(ctx);

			expect(storage.deleteApiKey).toHaveBeenCalledWith(mockEnv, 'user-123', 'key-to-delete');
			expect(response).toBeDefined();
			expect(response?.status).toBe(404);
			const data = await response?.json();
			expect(data).toEqual({ error: 'Key not found or unauthorized' });
		});

		it('should return 200 on successful deletion', async () => {
			vi.mocked(storage.deleteApiKey).mockResolvedValue(true);

			const ctx = createMockContext('DELETE', '/api-keys/key-to-delete');
			const response = await handleApiKeyRoute(ctx);

			expect(storage.deleteApiKey).toHaveBeenCalledWith(mockEnv, 'user-123', 'key-to-delete');
			expect(response).toBeDefined();
			expect(response?.status).toBe(200);
			const data = await response?.json();
			expect(data).toEqual({ message: 'Deleted successfully' });
		});
	});

	describe('unmatched routes', () => {
		it('should return undefined for other HTTP methods', async () => {
			const ctx = createMockContext('PUT', '/api-keys');
			const response = await handleApiKeyRoute(ctx);

			expect(response).toBeUndefined();
		});

		it('should return undefined for other paths', async () => {
			const ctx = createMockContext('GET', '/other-path');
			const response = await handleApiKeyRoute(ctx);

			expect(response).toBeUndefined();
		});
	});
});
