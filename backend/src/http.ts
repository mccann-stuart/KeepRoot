import type { AuthenticatedUser, StorageEnv } from './storage';

export const corsHeaders = {
	'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function applyCorsHeaders(request: Request, headers: Headers): Headers {
	for (const [key, value] of Object.entries(corsHeaders)) {
		headers.set(key, value);
	}

	const origin = request.headers.get('Origin');
	const urlOrigin = new URL(request.url).origin;

	if (
		origin &&
		(origin === urlOrigin ||
			origin.startsWith('chrome-extension://') ||
			origin.startsWith('moz-extension://') ||
			origin.startsWith('safari-web-extension://'))
	) {
		headers.set('Access-Control-Allow-Origin', origin);
	} else {
		headers.set('Access-Control-Allow-Origin', urlOrigin);
	}

	return headers;
}

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

export function jsonResponse(request: Request, body: unknown, status = 200, headers?: HeadersInit): Response {
	const responseHeaders = applyCorsHeaders(request, new Headers(headers));
	responseHeaders.set('Content-Type', 'application/json');
	return new Response(JSON.stringify(body), {
		headers: responseHeaders,
		status,
	});
}

export function textResponse(request: Request, body: string, contentType: string, status = 200, headers?: HeadersInit): Response {
	const responseHeaders = applyCorsHeaders(request, new Headers(headers));
	responseHeaders.set('Content-Type', contentType);
	return new Response(body, {
		headers: responseHeaders,
		status,
	});
}

export function errorResponse(request: Request, message: string, status: number): Response {
	return jsonResponse(request, { error: message }, status);
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
