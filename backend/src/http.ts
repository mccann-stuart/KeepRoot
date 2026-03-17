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
	if (!origin) {
		return headers;
	}

	const requestUrl = new URL(request.url);
	if (
		origin === requestUrl.origin
		|| origin.startsWith('chrome-extension://')
		|| origin.startsWith('moz-extension://')
		|| origin.startsWith('safari-web-extension://')
	) {
		headers.set('Access-Control-Allow-Origin', origin);
		headers.set('Vary', 'Origin');
	}

	return headers;
}

export function jsonResponse(body: unknown, status?: number, headers?: HeadersInit): Response;
export function jsonResponse(request: Request, body: unknown, status?: number, headers?: HeadersInit): Response;
export function jsonResponse(
	requestOrBody: Request | unknown,
	bodyOrStatus?: unknown,
	statusOrHeaders?: number | HeadersInit,
	headers?: HeadersInit,
): Response {
	const request = requestOrBody instanceof Request ? requestOrBody : null;
	const body = request ? bodyOrStatus : requestOrBody;
	const status = typeof bodyOrStatus === 'number'
		? bodyOrStatus
		: typeof statusOrHeaders === 'number'
			? statusOrHeaders
			: 200;
	const initHeaders = request ? (typeof statusOrHeaders === 'number' ? headers : statusOrHeaders) : statusOrHeaders;
	const responseHeaders = request
		? applyCorsHeaders(request, new Headers(initHeaders))
		: new Headers(initHeaders);
	responseHeaders.set('Content-Type', 'application/json');
	return new Response(JSON.stringify(body), {
		headers: responseHeaders,
		status,
	});
}

export function textResponse(body: string, contentType: string, status?: number, headers?: HeadersInit): Response;
export function textResponse(request: Request, body: string, contentType: string, status?: number, headers?: HeadersInit): Response;
export function textResponse(
	requestOrBody: Request | string,
	bodyOrContentType: string,
	contentTypeOrStatus?: string | number,
	statusOrHeaders?: number | HeadersInit,
	headers?: HeadersInit,
): Response {
	const request = requestOrBody instanceof Request ? requestOrBody : null;
	const body = request ? bodyOrContentType : requestOrBody;
	const contentType = request ? String(contentTypeOrStatus) : bodyOrContentType;
	const status = request
		? typeof statusOrHeaders === 'number' ? statusOrHeaders : 200
		: typeof contentTypeOrStatus === 'number' ? contentTypeOrStatus : 200;
	const initHeaders = request
		? (typeof statusOrHeaders === 'number' ? headers : statusOrHeaders)
		: statusOrHeaders;
	const responseHeaders = request
		? applyCorsHeaders(request, new Headers(initHeaders))
		: new Headers(initHeaders);
	responseHeaders.set('Content-Type', contentType);
	return new Response(body, {
		headers: responseHeaders,
		status,
	});
}

export function errorResponse(message: string, status: number): Response;
export function errorResponse(request: Request, message: string, status: number): Response;
export function errorResponse(requestOrMessage: Request | string, messageOrStatus: string | number, maybeStatus?: number): Response {
	if (requestOrMessage instanceof Request) {
		return jsonResponse(requestOrMessage, { error: messageOrStatus }, maybeStatus ?? 500);
	}

	return jsonResponse({ error: requestOrMessage }, Number(messageOrStatus));
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
