import { authenticateBearerToken, ensureOrganizationSchema, type StorageEnv } from './storage';
import { createRouteContext, errorResponse, isProtectedApiPath, type ProtectedRouteContext } from './http';
import { handleAuthRoute } from './routes/auth';
import { handleApiKeyRoute } from './routes/api-keys';
import { handleBookmarkRoute } from './routes/bookmarks';
import { handleListRoute } from './routes/lists';
import { handlePublicRoute } from './routes/public';
import { handleSmartListRoute } from './routes/smart-lists';

export interface Env extends StorageEnv {}

function createProtectedContext(context: ReturnType<typeof createRouteContext>, authUser: NonNullable<Awaited<ReturnType<typeof authenticateBearerToken>>>): ProtectedRouteContext {
	return {
		...context,
		authUser,
	};
}

function applyCorsHeaders(response: Response, request: Request): Response {
	const origin = request.headers.get('Origin');
	const url = new URL(request.url);
	let allowedOrigin = url.origin;

	if (origin && (
		origin === url.origin ||
		origin.startsWith('chrome-extension://') ||
		origin.startsWith('moz-extension://') ||
		origin.startsWith('safari-web-extension://')
	)) {
		allowedOrigin = origin;
	}

	const headers = new Headers(response.headers);
	headers.set('Access-Control-Allow-Origin', allowedOrigin);
	headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
	headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	headers.set('Vary', 'Origin');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const context = createRouteContext(request, env);

		let response: Response;

		const publicResponse = await handlePublicRoute(context);
		if (publicResponse) {
			response = publicResponse;
		} else {
			const authResponse = await handleAuthRoute(context);
			if (authResponse) {
				response = authResponse;
			} else if (!isProtectedApiPath(context.pathname)) {
				response = errorResponse('Not found', 404);
			} else {
				const authHeader = request.headers.get('Authorization');
				const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
				const authUser = token ? await authenticateBearerToken(env, token) : null;

				if (!authUser) {
					response = errorResponse('Unauthorized', 401);
				} else {
					try {
						await ensureOrganizationSchema(env);

						const protectedContext = createProtectedContext(context, authUser);

						response = await handleApiKeyRoute(protectedContext)
							?? await handleBookmarkRoute(protectedContext)
							?? await handleListRoute(protectedContext)
							?? await handleSmartListRoute(protectedContext)
							?? errorResponse('Not found', 404);
					} catch (error) {
						console.error(error);
						response = errorResponse('Internal Server Error', 500);
					}
				}
			}
		}

		return applyCorsHeaders(response, request);
	},
};
