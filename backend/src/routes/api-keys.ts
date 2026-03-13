import { errorResponse, jsonResponse, parseJson, type ProtectedRouteContext } from '../http';
import { createApiKey, deleteApiKey, listApiKeys } from '../storage';

export async function handleApiKeyRoute(context: ProtectedRouteContext): Promise<Response | undefined> {
	if (context.request.method === 'GET' && context.pathname === '/api-keys') {
		const keys = await listApiKeys(context.env, context.authUser.userId);
		return jsonResponse({ keys });
	}

	if (context.request.method === 'POST' && context.pathname === '/api-keys') {
		const body = await parseJson<{ name?: string }>(context.request);
		const keyName = body.name?.trim() || 'Unnamed Key';
		const { metadata, secret } = await createApiKey(context.env, context.authUser, keyName);
		return jsonResponse({ metadata, secret }, 201);
	}

	if (context.request.method === 'DELETE' && context.pathname.startsWith('/api-keys/')) {
		const keyId = context.pathname.slice('/api-keys/'.length);
		if (!keyId) {
			return errorResponse('Missing ID', 400);
		}

		const deleted = await deleteApiKey(context.env, context.authUser.userId, keyId);
		if (!deleted) {
			return errorResponse('Key not found or unauthorized', 404);
		}

		return jsonResponse({ message: 'Deleted successfully' });
	}

	return undefined;
}
