import { applyCorsHeaders, errorResponse, isProtectedApiPath, type RouteContext } from '../http';

async function handleStoredObjectRequest(context: RouteContext): Promise<Response> {
	const objectKey = context.pathname.slice(1);
	const objectBody = await context.env.KEEPROOT_CONTENT.get(objectKey);
	if (!objectBody) {
		return errorResponse(context.request, 'Not found', 404);
	}

	const headers = applyCorsHeaders(context.request, new Headers());
	objectBody.writeHttpMetadata(headers);
	headers.set('etag', objectBody.httpEtag);
	headers.set('Cache-Control', 'public, max-age=31536000, immutable');
	return new Response(objectBody.body, { headers });
}

async function handleStaticAssetRequest(context: RouteContext): Promise<Response> {
	if (!context.env.ASSETS) {
		return errorResponse(context.request, 'Static asset binding unavailable', 500);
	}

	return context.env.ASSETS.fetch(context.request);
}

function isPublicAssetPath(pathname: string): boolean {
	return !pathname.startsWith('/auth/') && !isProtectedApiPath(pathname);
}

export async function handlePublicRoute(context: RouteContext): Promise<Response | undefined> {
	if (context.request.method === 'OPTIONS') {
		const headers = applyCorsHeaders(context.request, new Headers());
		return new Response(null, { headers });
	}

	if (context.request.method === 'GET' && (context.pathname.startsWith('/images/') || context.pathname.startsWith('/thumbs/'))) {
		return handleStoredObjectRequest(context);
	}

	if ((context.request.method === 'GET' || context.request.method === 'HEAD') && isPublicAssetPath(context.pathname)) {
		return handleStaticAssetRequest(context);
	}

	return undefined;
}
