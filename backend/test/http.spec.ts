import { describe, expect, it } from 'vitest';
import {
	clearDashboardSessionCookie,
	corsHeaders,
	createDashboardSessionCookie,
	createRouteContext,
	errorResponse,
	getRequestAuthToken,
	jsonResponse,
	normalizePathname,
	resolveCorsOrigin,
	textResponse,
} from '../src/http';

describe('http utilities', () => {
	describe('dashboard session cookies', () => {
		it('creates a secure seven-day cookie for HTTPS requests', () => {
			const request = new Request('https://example.com/auth/verify-authentication');

			expect(createDashboardSessionCookie(request, 'session-token')).toBe(
				'keeproot_session=session-token; Max-Age=604800; HttpOnly; Path=/; SameSite=Strict; Secure',
			);
			expect(clearDashboardSessionCookie(request)).toBe(
				'keeproot_session=; Max-Age=0; HttpOnly; Path=/; SameSite=Strict; Secure',
			);
		});

		it('accepts dashboard cookies for reads and same-origin writes only', () => {
			const headers = { Cookie: 'other=value; keeproot_session=session-token' };

			expect(getRequestAuthToken(new Request('https://example.com/account', { headers }))).toEqual({
				source: 'cookie',
				token: 'session-token',
			});
			expect(getRequestAuthToken(new Request('https://example.com/bookmarks', {
				headers: { ...headers, Origin: 'https://example.com' },
				method: 'POST',
			}))).toEqual({
				source: 'cookie',
				token: 'session-token',
			});
			expect(getRequestAuthToken(new Request('https://example.com/bookmarks', {
				headers: { ...headers, Origin: 'https://attacker.example' },
				method: 'POST',
			}))).toBeNull();
		});

		it('prefers bearer tokens and can disable cookie authentication', () => {
			const request = new Request('https://example.com/account', {
				headers: {
					Authorization: 'Bearer api-token',
					Cookie: 'keeproot_session=session-token',
				},
			});

			expect(getRequestAuthToken(request)).toEqual({ source: 'bearer', token: 'api-token' });
			expect(getRequestAuthToken(new Request('https://example.com/account', {
				headers: { Cookie: 'keeproot_session=session-token' },
			}), false)).toBeNull();
		});
	});

	describe('createRouteContext', () => {
		it('extracts route context for a standard URL', () => {
			const request = new Request('https://example.com/path/to/resource');
			const env = { SOME_ENV_VAR: 'test' } as any;
			const context = createRouteContext(request, env);

			expect(context.env).toBe(env);
			expect(context.origin).toBe('https://example.com');
			expect(context.pathname).toBe('/path/to/resource');
			expect(context.request).toBe(request);
			expect(context.rpID).toBe('example.com');
			expect(context.url.href).toBe('https://example.com/path/to/resource');
		});

		it('normalizes the pathname', () => {
			const context = createRouteContext(
				new Request('https://example.com/bookmarks/bookmarks/123/'),
				{} as any,
			);

			expect(context.pathname).toBe('/bookmarks/123');
		});

		it('extracts the rpID for an IPv6 address', () => {
			const context = createRouteContext(
				new Request('http://[::1]:8080/test'),
				{} as any,
			);

			expect(context.origin).toBe('http://[::1]:8080');
			expect(context.rpID).toBe('[::1]');
		});

		it('preserves a custom port in the origin but not the rpID', () => {
			const context = createRouteContext(
				new Request('https://example.com:3000/api/data'),
				{} as any,
			);

			expect(context.origin).toBe('https://example.com:3000');
			expect(context.rpID).toBe('example.com');
		});
	});

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

	describe('textResponse', () => {
		it('returns a text response with the default status', async () => {
			const response = textResponse('hello', 'text/plain');

			expect(response.status).toBe(200);
			expect(response.headers.get('Content-Type')).toBe('text/plain');
			expect(await response.text()).toBe('hello');
		});

		it('applies a custom status and headers', async () => {
			const response = textResponse('error', 'text/plain', 400, { 'X-Custom': 'value' });

			expect(response.status).toBe(400);
			expect(response.headers.get('Content-Type')).toBe('text/plain');
			expect(response.headers.get('X-Custom')).toBe('value');
			expect(await response.text()).toBe('error');
		});

		it('applies standard CORS headers when a request is provided', async () => {
			const request = new Request('https://api.example.com/data');
			const response = textResponse(request, 'hello', 'text/plain');

			expect(response.status).toBe(200);
			expect(response.headers.get('Content-Type')).toBe('text/plain');
			for (const [key, value] of Object.entries(corsHeaders)) {
				expect(response.headers.get(key)).toBe(value);
			}
			expect(await response.text()).toBe('hello');
		});

		it('applies allowed-origin CORS and custom response options', async () => {
			const request = new Request('https://example.com/data', {
				headers: { Origin: 'https://example.com' },
			});
			const response = textResponse(request, 'created', 'text/html', 201, { 'X-Test': 'true' });

			expect(response.status).toBe(201);
			expect(response.headers.get('Content-Type')).toBe('text/html');
			expect(response.headers.get('X-Test')).toBe('true');
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
			expect(await response.text()).toBe('created');
		});
	});

	describe('errorResponse', () => {
		it('returns a JSON error with the requested status', async () => {
			const response = errorResponse('Something went wrong', 400);

			expect(response.status).toBe(400);
			expect(response.headers.get('Content-Type')).toBe('application/json');
			expect(await response.json()).toEqual({ error: 'Something went wrong' });
		});

		it('applies CORS headers when a request is provided', async () => {
			const request = new Request('https://example.com/data', {
				headers: { Origin: 'https://example.com' },
			});
			const response = errorResponse(request, 'Not found', 404);

			expect(response.status).toBe(404);
			expect(response.headers.get('Content-Type')).toBe('application/json');
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
			expect(await response.json()).toEqual({ error: 'Not found' });
		});

		it('defaults to status 500 when the request signature omits a status', async () => {
			const request = new Request('https://example.com/data');
			const response = (errorResponse as any)(request, 'Server error');

			expect(response.status).toBe(500);
			expect(await response.json()).toEqual({ error: 'Server error' });
		});
	});

	describe('jsonResponse', () => {
		it('returns a valid JSON response with default status 200', async () => {
			const body = { a: 1 };
			const response = jsonResponse(body);

			expect(response.status).toBe(200);
			expect(response.headers.get('Content-Type')).toBe('application/json');
			expect(await response.json()).toEqual(body);
		});

		it('returns a valid JSON response with a specific status', async () => {
			const body = { a: 1 };
			const response = jsonResponse(body, 201);

			expect(response.status).toBe(201);
			expect(response.headers.get('Content-Type')).toBe('application/json');
			expect(await response.json()).toEqual(body);
		});

		it('applies custom headers', async () => {
			const body = { a: 1 };
			const response = jsonResponse(body, 200, { 'X-Custom': 'test' });

			expect(response.status).toBe(200);
			expect(response.headers.get('Content-Type')).toBe('application/json');
			expect(response.headers.get('X-Custom')).toBe('test');
			expect(await response.json()).toEqual(body);
		});

		it('applies CORS headers when a request is provided', async () => {
			const request = new Request('https://example.com/api');
			const body = { a: 1 };
			const response = jsonResponse(request, body);

			expect(response.status).toBe(200);
			expect(response.headers.get('Content-Type')).toBe('application/json');

			for (const [key, value] of Object.entries(corsHeaders)) {
				expect(response.headers.get(key)).toBe(value);
			}
			expect(await response.json()).toEqual(body);
		});

		it('treats a numeric request body as the body, not the status', async () => {
			const request = new Request('https://example.com/api', {
				headers: { Origin: 'https://example.com' },
			});
			const response = jsonResponse(request, 42, 201);

			expect(response.status).toBe(201);
			expect(await response.json()).toBe(42);
		});

		it('applies Access-Control-Allow-Origin header when allowed origin matches', async () => {
			const request = new Request('https://example.com/api', {
				headers: { Origin: 'https://example.com' },
			});
			const body = { a: 1 };
			const response = jsonResponse(request, body);

			expect(response.status).toBe(200);
			expect(response.headers.get('Content-Type')).toBe('application/json');
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
			expect(response.headers.get('Vary')).toBe('Origin');
			expect(await response.json()).toEqual(body);
		});
	});
});
