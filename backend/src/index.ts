import { createMcpHandler } from 'agents/mcp';
import { ingestEmailMessage } from './ingest/email';
import { processIngestJob, type IngestJob } from './ingest/jobs';
import { syncAllActiveSources } from './ingest/source-sync';
import { buildKeepRootMcpServer } from './mcp/server';
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
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const context = createRouteContext(request, env);

		if (context.pathname === '/mcp') {
			const authHeader = request.headers.get('Authorization');
			const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
			const authUser = token ? await authenticateBearerToken(env, token) : null;
			if (!authUser) {
				return errorResponse('Unauthorized', 401);
			}

			try {
				await ensureOrganizationSchema(env);
				const server = buildKeepRootMcpServer(env, authUser);
				const handler = createMcpHandler(server, {
					authContext: {
						props: {
							tokenType: authUser.tokenType,
							userId: authUser.userId,
							username: authUser.username,
						},
					},
					route: '/mcp',
					sessionIdGenerator: undefined,
				});
				return handler(request, env, ctx);
			} catch (error) {
				console.error(error);
				return errorResponse('Internal Server Error', 500);
			}
		}

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

	async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
		await ensureOrganizationSchema(env);
		await syncAllActiveSources(env);
	},

	async queue(batch: MessageBatch<IngestJob>, env: Env): Promise<void> {
		await ensureOrganizationSchema(env);
		for (const message of batch.messages) {
			await processIngestJob(env, message.body);
		}
	},

	async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
		await ensureOrganizationSchema(env);
		await ingestEmailMessage(env, message);
	},
};
