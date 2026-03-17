import { jsonResponse, type ProtectedRouteContext } from '../http';
import { getUsageStats } from '../storage';

export async function handleStatsRoute(context: ProtectedRouteContext): Promise<Response | undefined> {
	if (context.request.method === 'GET' && context.pathname === '/stats') {
		const stats = await getUsageStats(context.env, context.authUser.userId);
		return jsonResponse(stats);
	}

	return undefined;
}
