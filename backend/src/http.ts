import type { AuthenticatedUser, StorageEnv } from './storage';

export const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const securityHeaders = {
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export interface RouteContext<Env extends StorageEnv = StorageEnv> {
	env: Env;
	origin: string;
	pathname: string;
	request: Request;
	rpID: string;
	url: URL;
}

export interface ProtectedRouteContext<Env extends StorageEnv = StorageEnv> extends RouteContext<Env> {
	authUser: AuthenticatedUser;
}

export function normalizePathname(pathname: string): string {
	let normalizedPathname = pathname.replace(/\/{2,}/g, '/');

	if (normalizedPathname.length > 1 && normalizedPathname.endsWith('/')) {
		normalizedPathname = normalizedPathname.slice(0, -1);
	}

	if (normalizedPathname === '/bookmarks/bookmarks') {
		return '/bookmarks';
	}

	if (normalizedPathname.startsWith('/bookmarks/bookmarks/')) {
		return normalizedPathname.replace('/bookmarks/bookmarks/', '/bookmarks/');
	}

	return normalizedPathname;
}

export function createRouteContext<Env extends StorageEnv>(request: Request, env: Env): RouteContext<Env> {
	const url = new URL(request.url);
	return {
		env,
		origin: url.origin,
		pathname: normalizePathname(url.pathname),
		request,
		rpID: url.hostname,
		url,
	};
}

export function appendSecurityHeaders(headers: Headers): Headers {
	for (const [key, value] of Object.entries(corsHeaders)) {
		headers.set(key, value);
	}
	for (const [key, value] of Object.entries(securityHeaders)) {
		headers.set(key, value);
	}
	return headers;
}

export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
	const responseHeaders = appendSecurityHeaders(new Headers(headers));
	responseHeaders.set('Content-Type', 'application/json');
	return new Response(JSON.stringify(body), {
		headers: responseHeaders,
		status,
	});
}

export function textResponse(body: string, contentType: string, status = 200, headers?: HeadersInit): Response {
	const responseHeaders = appendSecurityHeaders(new Headers(headers));
	responseHeaders.set('Content-Type', contentType);
	return new Response(body, {
		headers: responseHeaders,
		status,
	});
}

export function errorResponse(message: string, status: number): Response {
	return jsonResponse({ error: message }, status);
}

export async function parseJson<T>(request: Request): Promise<T> {
	return request.json() as Promise<T>;
}

export function isProtectedApiPath(pathname: string): boolean {
	return pathname === '/api-keys'
		|| pathname.startsWith('/api-keys/')
		|| pathname === '/bookmarks'
		|| pathname.startsWith('/bookmarks/')
		|| pathname === '/lists'
		|| pathname.startsWith('/lists/')
		|| pathname === '/smart-lists'
		|| pathname.startsWith('/smart-lists/');
}
