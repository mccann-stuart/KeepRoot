import { errorResponse, isProtectedApiPath, type ProtectedRouteContext, type RouteContext } from '../http';
import { canAccessStoredMedia } from '../storage';

export async function handleProtectedStoredObjectRoute(context: ProtectedRouteContext): Promise<Response | undefined> {
	if ((context.request.method !== 'GET' && context.request.method !== 'HEAD')
		|| (!context.pathname.startsWith('/images/') && !context.pathname.startsWith('/thumbs/'))) {
		return undefined;
	}

	const objectKey = context.pathname.slice(1);
	if (!(await canAccessStoredMedia(context.env, context.authUser.userId, objectKey))) {
		return errorResponse(context.request, 'Not found', 404);
	}

	const objectBody = await context.env.KEEPROOT_CONTENT.get(objectKey);
	if (!objectBody) {
		return errorResponse(context.request, 'Not found', 404);
	}

	const headers = new Headers();
	objectBody.writeHttpMetadata(headers);
	headers.set('etag', objectBody.httpEtag);
	headers.set('Cache-Control', 'no-store');
	headers.set('Vary', 'Authorization');
	return new Response(context.request.method === 'HEAD' ? null : objectBody.body, { headers });
}

async function handleStaticAssetRequest(context: RouteContext): Promise<Response> {
	if (!context.env.ASSETS) {
		return errorResponse('Static asset binding unavailable', 500);
	}

	return context.env.ASSETS.fetch(context.request);
}

function isPublicAssetPath(pathname: string): boolean {
	return !pathname.startsWith('/auth/') && !isProtectedApiPath(pathname);
}

export async function handlePublicRoute(context: RouteContext): Promise<Response | undefined> {
	if (context.request.method === 'OPTIONS') {
		return new Response(null);
	}

	if ((context.request.method === 'GET' || context.request.method === 'HEAD') && isPublicAssetPath(context.pathname)) {
		return handleStaticAssetRequest(context);
	}

	return undefined;
}
