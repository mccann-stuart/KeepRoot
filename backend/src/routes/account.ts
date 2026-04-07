import { errorResponse, jsonResponse, type ProtectedRouteContext } from '../http';
import { clearUserData, getWhoAmI } from '../storage';

export async function handleAccountRoute(context: ProtectedRouteContext): Promise<Response | undefined> {
	if (context.request.method === 'GET' && context.pathname === '/account') {
		const account = await getWhoAmI(context.env, context.authUser);
		return jsonResponse(account);
	}

	if (context.request.method === 'DELETE' && context.pathname === '/account/data') {
		if (context.authUser.tokenType !== 'session') {
			return errorResponse('Clear all data requires a signed-in dashboard session', 403);
		}

		await clearUserData(context.env, context.authUser.userId);
		return jsonResponse({ message: 'All data cleared' });
	}

	return undefined;
}
