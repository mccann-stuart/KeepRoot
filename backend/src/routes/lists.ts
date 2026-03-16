import { errorResponse, jsonResponse, parseJson, type ProtectedRouteContext } from '../http';
import { createList, deleteList, listUserLists, updateList } from '../storage';

export async function handleListRoute(context: ProtectedRouteContext): Promise<Response | undefined> {
	if (context.request.method === 'GET' && context.pathname === '/lists') {
		const lists = await listUserLists(context.env, context.authUser.userId);
		return jsonResponse(context.request, { lists });
	}

	if (context.request.method === 'POST' && context.pathname === '/lists') {
		const body = await parseJson<{ name?: string; sortOrder?: number }>(context.request);
		if (!body.name) {
			return errorResponse(context.request, 'Name required', 400);
		}
		const list = await createList(context.env, context.authUser.userId, {
			name: body.name,
			sortOrder: body.sortOrder,
		});
		return jsonResponse(context.request, list, 201);
	}

	if (context.request.method === 'PATCH' && context.pathname.startsWith('/lists/')) {
		const listId = context.pathname.slice('/lists/'.length);
		const body = await parseJson<{ name?: string; sortOrder?: number }>(context.request);
		const updated = await updateList(context.env, context.authUser.userId, listId, body);
		if (!updated) {
			return errorResponse(context.request, 'Not found', 404);
		}
		return jsonResponse(context.request, { message: 'Updated successfully' });
	}

	if (context.request.method === 'DELETE' && context.pathname.startsWith('/lists/')) {
		const listId = context.pathname.slice('/lists/'.length);
		const deleted = await deleteList(context.env, context.authUser.userId, listId);
		if (!deleted) {
			return errorResponse(context.request, 'Not found', 404);
		}
		return jsonResponse(context.request, { message: 'Deleted successfully' });
	}

	return undefined;
}
