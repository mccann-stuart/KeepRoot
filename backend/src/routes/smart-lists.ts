import { errorResponse, jsonResponse, parseJson, type ProtectedRouteContext } from '../http';
import { createSmartList, deleteSmartList, listUserSmartLists, updateSmartList } from '../storage';

export async function handleSmartListRoute(context: ProtectedRouteContext): Promise<Response | undefined> {
	if (context.request.method === 'GET' && context.pathname === '/smart-lists') {
		const lists = await listUserSmartLists(context.env, context.authUser.userId);
		return jsonResponse({ lists });
	}

	if (context.request.method === 'POST' && context.pathname === '/smart-lists') {
		const body = await parseJson<{ icon?: string; name?: string; rules?: string; sortOrder?: number }>(context.request);
		const name = body.name?.trim();
		const rules = body.rules?.trim();
		if (!name || !rules) {
			return errorResponse('Name and rules required', 400);
		}
		const list = await createSmartList(context.env, context.authUser.userId, {
			icon: body.icon,
			name,
			rules,
			sortOrder: body.sortOrder,
		});
		return jsonResponse(list, 201);
	}

	if (context.request.method === 'PATCH' && context.pathname.startsWith('/smart-lists/')) {
		const listId = context.pathname.slice('/smart-lists/'.length);
		const body = await parseJson<{ icon?: string; name?: string; rules?: string; sortOrder?: number }>(context.request);
		const updated = await updateSmartList(context.env, context.authUser.userId, listId, body);
		if (!updated) {
			return errorResponse('Not found', 404);
		}
		return jsonResponse({ message: 'Updated successfully' });
	}

	if (context.request.method === 'DELETE' && context.pathname.startsWith('/smart-lists/')) {
		const listId = context.pathname.slice('/smart-lists/'.length);
		const deleted = await deleteSmartList(context.env, context.authUser.userId, listId);
		if (!deleted) {
			return errorResponse('Not found', 404);
		}
		return jsonResponse({ message: 'Deleted successfully' });
	}

	return undefined;
}
