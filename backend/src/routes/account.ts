import { jsonResponse, type ProtectedRouteContext } from '../http';
import { getWhoAmI } from '../storage';

export async function handleAccountRoute(context: ProtectedRouteContext): Promise<Response | undefined> {
	if (context.request.method === 'GET' && context.pathname === '/account') {
		const account = await getWhoAmI(context.env, context.authUser);
		return jsonResponse(account);
	}

	return undefined;
}
