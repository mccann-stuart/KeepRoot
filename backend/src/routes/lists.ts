import { errorResponse, jsonResponse, parseJson, type ProtectedRouteContext } from '../http';
import { createList, deleteList, listUserLists, updateList } from '../storage';

export async function handleListRoute(context: ProtectedRouteContext): Promise<Response | undefined> {
	if (context.request.method === 'GET' && context.pathname === '/lists') {
		const lists = await listUserLists(context.env, context.authUser.userId);
		return jsonResponse({ lists });
	}

	if (context.request.method === 'POST' && context.pathname === '/lists') {
		const body = await parseJson<{ name?: string; sortOrder?: number }>(context.request);
		if (!body.name) {
			return errorResponse('Name required', 400);
		}
		const list = await createList(context.env, context.authUser.userId, {
			name: body.name,
			sortOrder: body.sortOrder,
		});
		return jsonResponse(list, 201);
	}

	if (context.request.method === 'PATCH' && context.pathname.startsWith('/lists/')) {
		const listId = context.pathname.slice('/lists/'.length);
		const body = await parseJson<{ name?: string; sortOrder?: number }>(context.request);
		const updated = await updateList(context.env, context.authUser.userId, listId, body);
		if (!updated) {
			return errorResponse('Not found', 404);
		}
		return jsonResponse({ message: 'Updated successfully' });
	}

	if (context.request.method === 'DELETE' && context.pathname.startsWith('/lists/')) {
		const listId = context.pathname.slice('/lists/'.length);
		const deleted = await deleteList(context.env, context.authUser.userId, listId);
		if (!deleted) {
			return errorResponse('Not found', 404);
		}
		return jsonResponse({ message: 'Deleted successfully' });
	}

	return undefined;
}
