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

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const context = createRouteContext(request, env);

		const publicResponse = await handlePublicRoute(context);
		if (publicResponse) {
			return publicResponse;
		}

		const authResponse = await handleAuthRoute(context);
		if (authResponse) {
			return authResponse;
		}

		if (!isProtectedApiPath(context.pathname)) {
			return errorResponse('Not found', 404);
		}

		const authHeader = request.headers.get('Authorization');
		const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
		const authUser = token ? await authenticateBearerToken(env, token) : null;

		if (!authUser) {
			return errorResponse('Unauthorized', 401);
		}

		try {
			await ensureOrganizationSchema(env);

			const protectedContext = createProtectedContext(context, authUser);

			return await handleApiKeyRoute(protectedContext)
				?? await handleBookmarkRoute(protectedContext)
				?? await handleListRoute(protectedContext)
				?? await handleSmartListRoute(protectedContext)
				?? errorResponse('Not found', 404);
		} catch (error) {
			console.error(error);
			return errorResponse('Internal Server Error', 500);
		}
	},
};
