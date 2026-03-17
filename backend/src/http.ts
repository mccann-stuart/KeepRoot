import type { AuthenticatedUser, StorageEnv } from './storage';

export const corsHeaders = {
	'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

export function applyCorsHeaders(request: Request, headers: Headers): Headers {
	for (const [key, value] of Object.entries(corsHeaders)) {
		headers.set(key, value);
	}

	const origin = request.headers.get('Origin');
	if (origin) {
		const requestUrl = new URL(request.url);
		try {
			const originUrl = new URL(origin);
			if (
				origin === requestUrl.origin
				|| originUrl.protocol === 'chrome-extension:'
				|| originUrl.protocol === 'moz-extension:'
				|| originUrl.protocol === 'safari-web-extension:'
				|| (originUrl.protocol === 'http:' && originUrl.hostname === 'localhost')
				|| (originUrl.protocol === 'https:' && (originUrl.hostname === 'keeproot.com' || originUrl.hostname === 'www.keeproot.com'))
			) {
				headers.set('Access-Control-Allow-Origin', origin);
			}
		} catch {
			// Ignore invalid origin formats
		}
	}

	return headers;
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
