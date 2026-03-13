import { errorResponse, jsonResponse, parseJson, type ProtectedRouteContext } from '../http';
import { deleteBookmark, getBookmark, listBookmarks, patchBookmark, saveBookmark, type BookmarkPayload } from '../storage';

export async function handleBookmarkRoute(context: ProtectedRouteContext): Promise<Response | undefined> {
	if (context.request.method === 'POST' && context.pathname === '/bookmarks') {
		const body = await parseJson<BookmarkPayload>(context.request);
		const { id, metadata } = await saveBookmark(context.env, context.authUser, body);
		return jsonResponse({ id, message: 'Saved successfully', metadata }, 201);
	}

	if (context.request.method === 'GET' && context.pathname === '/bookmarks') {
		const keys = await listBookmarks(context.env, context.authUser.userId);
		return jsonResponse({ keys });
	}

	if (context.request.method === 'PATCH' && context.pathname.startsWith('/bookmarks/')) {
		const bookmarkId = context.pathname.slice('/bookmarks/'.length);
		if (!bookmarkId) {
			return errorResponse('Missing ID', 400);
		}

		const body = await parseJson<Record<string, unknown>>(context.request);
		const updated = await patchBookmark(context.env, context.authUser.userId, bookmarkId, body);
		if (!updated && body.tags === undefined) {
			return errorResponse('Not found or no changes', 404);
		}

		return jsonResponse({ message: 'Updated successfully' });
	}

	if (context.request.method === 'GET' && context.pathname.startsWith('/bookmarks/')) {
		const bookmarkId = context.pathname.slice('/bookmarks/'.length);
		if (!bookmarkId) {
			return errorResponse('Missing ID', 400);
		}

		const bookmark = await getBookmark(context.env, context.authUser.userId, bookmarkId);
		if (!bookmark) {
			return errorResponse('Not found', 404);
		}

		return jsonResponse(bookmark);
	}

	if (context.request.method === 'DELETE' && context.pathname.startsWith('/bookmarks/')) {
		const bookmarkId = context.pathname.slice('/bookmarks/'.length);
		if (!bookmarkId) {
			return errorResponse('Missing ID', 400);
		}

		const deleted = await deleteBookmark(context.env, context.authUser.userId, bookmarkId);
		if (!deleted) {
			return errorResponse('Not found', 404);
		}

		return jsonResponse({ message: 'Deleted successfully' });
	}

	return undefined;
}
