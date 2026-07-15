import { describe, expect, it } from 'vitest';
import { normalizePathname, resolveCorsOrigin, jsonResponse } from '../src/http';

describe('http utilities', () => {
	describe('resolveCorsOrigin', () => {
		it('returns null if there is no Origin header', () => {
			const request = new Request('https://api.example.com/data');
			expect(resolveCorsOrigin(request)).toBeNull();
		});

		it('returns the origin if it matches the request URL origin', () => {
			const request = new Request('https://example.com/data', {
				headers: { Origin: 'https://example.com' },
			});
			expect(resolveCorsOrigin(request)).toBe('https://example.com');
		});

		it('returns the origin if it is an allowed extension protocol and ID is in ALLOWED_EXTENSION_IDS', () => {
			const request = new Request('https://api.example.com/data', {
				headers: { Origin: 'chrome-extension://abcdefghijklmnop' },
			});
			const env = { ALLOWED_EXTENSION_IDS: JSON.stringify(['abcdefghijklmnop']) } as any;
			expect(resolveCorsOrigin(request, env)).toBe('chrome-extension://abcdefghijklmnop');
		});

		it('returns null if origin is an extension protocol but ID is not allowed', () => {
			const request = new Request('https://api.example.com/data', {
				headers: { Origin: 'chrome-extension://invalidid' },
			});
			const env = { ALLOWED_EXTENSION_IDS: JSON.stringify(['abcdefghijklmnop']) } as any;
			expect(resolveCorsOrigin(request, env)).toBeNull();
		});

		it('returns null if origin is an extension protocol and no env is provided', () => {
			const request = new Request('https://api.example.com/data', {
				headers: { Origin: 'chrome-extension://abcdefghijklmnop' },
			});
			expect(resolveCorsOrigin(request)).toBeNull();
		});

		it('returns null if origin is an extension protocol but ALLOWED_EXTENSION_IDS is not a valid JSON array', () => {
			const request = new Request('https://api.example.com/data', {
				headers: { Origin: 'chrome-extension://abcdefghijklmnop' },
			});
			// Memory says ALLOWED_EXTENSION_IDS expects JSON serialized array.
			const env = { ALLOWED_EXTENSION_IDS: 'abcdefghijklmnop' } as any;
			expect(resolveCorsOrigin(request, env)).toBeNull();
		});

		it('returns null if origin is a disallowed protocol and does not match request origin', () => {
			const request = new Request('https://api.example.com/data', {
				headers: { Origin: 'https://malicious.com' },
			});
			expect(resolveCorsOrigin(request)).toBeNull();
		});

		it('returns null if origin is malformed', () => {
			const request = new Request('https://api.example.com/data', {
				headers: { Origin: 'not-a-valid-url' },
			});
			expect(resolveCorsOrigin(request)).toBeNull();
		});
	});

	describe('normalizePathname', () => {
		it('returns a normal path unchanged', () => {
			expect(normalizePathname('/path')).toBe('/path');
			expect(normalizePathname('/a/b/c')).toBe('/a/b/c');
		});

		it('replaces multiple consecutive slashes with a single slash', () => {
			expect(normalizePathname('//path')).toBe('/path');
			expect(normalizePathname('/a//b///c')).toBe('/a/b/c');
			expect(normalizePathname('////')).toBe('/');
		});

		it('removes a trailing slash, unless it is just the root', () => {
			expect(normalizePathname('/path/')).toBe('/path');
			expect(normalizePathname('/a/b/c/')).toBe('/a/b/c');
			expect(normalizePathname('/')).toBe('/');
		});

		it('replaces exactly "/bookmarks/bookmarks" with "/bookmarks"', () => {
			expect(normalizePathname('/bookmarks/bookmarks')).toBe('/bookmarks');
		});

		it('replaces the prefix "/bookmarks/bookmarks/" with "/bookmarks/"', () => {
			expect(normalizePathname('/bookmarks/bookmarks/123')).toBe('/bookmarks/123');
			expect(normalizePathname('/bookmarks/bookmarks/abc/def')).toBe('/bookmarks/abc/def');
		});

		it('does not replace "/bookmarks/bookmarks" if it is just a prefix without a trailing slash (e.g., /bookmarks/bookmarks-foo)', () => {
			expect(normalizePathname('/bookmarks/bookmarks-foo')).toBe('/bookmarks/bookmarks-foo');
		});

		it('handles complex combinations correctly', () => {
			// multiple slashes + trailing slash
			expect(normalizePathname('//a//b///')).toBe('/a/b');
			// multiple slashes + /bookmarks/bookmarks
			expect(normalizePathname('//bookmarks///bookmarks///')).toBe('/bookmarks');
			// multiple slashes + /bookmarks/bookmarks/ + suffix + trailing slash
			expect(normalizePathname('//bookmarks///bookmarks///123//')).toBe('/bookmarks/123');
		});
	});

	describe('jsonResponse', () => {
		it('creates a basic JSON response with default status 200', async () => {
			const res = jsonResponse({ key: 'value' });
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Type')).toBe('application/json');
			expect(await res.json()).toEqual({ key: 'value' });
		});

		it('creates a JSON response with a custom status', () => {
			const res = jsonResponse({ error: 'not found' }, 404);
			expect(res.status).toBe(404);
		});

		it('creates a JSON response with custom headers', () => {
			const res = jsonResponse({ data: 1 }, 200, { 'X-Custom-Header': 'custom' });
			expect(res.headers.get('X-Custom-Header')).toBe('custom');
			expect(res.headers.get('Content-Type')).toBe('application/json');
		});

		it('handles the signature with Request and applies CORS headers', () => {
			const req = new Request('https://example.com', { headers: { Origin: 'https://example.com' } });
			const res = jsonResponse(req, { ok: true }, 201, { 'X-Test': 'test' });

			expect(res.status).toBe(201);
			expect(res.headers.get('Content-Type')).toBe('application/json');
			expect(res.headers.get('X-Test')).toBe('test');
			expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
		});
	});
});
