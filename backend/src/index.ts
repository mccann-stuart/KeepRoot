import { createMcpHandler } from 'agents/mcp';
import { ingestEmailMessage } from './ingest/email';
import { processIngestJob, type IngestJob } from './ingest/jobs';
import { syncAllActiveSources } from './ingest/source-sync';
import { buildKeepRootMcpServer } from './mcp/server';
import { authenticateBearerToken, ensureOrganizationSchema, listActivePollableSources, type StorageEnv } from './storage';
import { createRouteContext, errorResponse, isProtectedApiPath, type ProtectedRouteContext } from './http';
import { handleAuthRoute } from './routes/auth';
import { handleAccountRoute } from './routes/account';
import { handleApiKeyRoute } from './routes/api-keys';
import { handleBookmarkRoute } from './routes/bookmarks';
import { handleListRoute } from './routes/lists';
import { handlePublicRoute } from './routes/public';
import { handleSmartListRoute } from './routes/smart-lists';
import { handleSourceRoute } from './routes/sources';
import { handleStatsRoute } from './routes/stats';

export interface Env extends StorageEnv {}

function createProtectedContext(context: ReturnType<typeof createRouteContext>, authUser: NonNullable<Awaited<ReturnType<typeof authenticateBearerToken>>>): ProtectedRouteContext {
	return {
		...context,
		authUser,
	};
}

function applyCorsHeaders(response: Response, request: Request): Response {
	const origin = request.headers.get('Origin');
	const url = new URL(request.url);
	let allowedOrigin = url.origin;

	if (origin && (
		origin === url.origin ||
		origin.startsWith('chrome-extension://') ||
		origin.startsWith('moz-extension://') ||
		origin.startsWith('safari-web-extension://')
	)) {
		allowedOrigin = origin;
	}

	const headers = new Headers(response.headers);
	headers.set('Access-Control-Allow-Origin', allowedOrigin);
	headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
	headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	headers.set('Vary', 'Origin');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const context = createRouteContext(request, env);
		let response: Response;

		if (context.pathname === '/mcp') {
			const authHeader = request.headers.get('Authorization');
			const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
			const authUser = token ? await authenticateBearerToken(env, token) : null;

			if (!authUser) {
				response = errorResponse('Unauthorized', 401);
			} else {
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
						enableJsonResponse: true,
						route: '/mcp',
						sessionIdGenerator: undefined,
					});
					response = await handler(request, env, ctx);
				} catch (error) {
					console.error(error);
					response = errorResponse('Internal Server Error', 500);
				}
			}
		} else {
			const publicResponse = await handlePublicRoute(context);
			if (publicResponse) {
				response = publicResponse;
			} else {
				const authResponse = await handleAuthRoute(context);
				if (authResponse) {
					response = authResponse;
				} else if (!isProtectedApiPath(context.pathname)) {
					response = errorResponse('Not found', 404);
				} else {
					const authHeader = request.headers.get('Authorization');
					const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
					const authUser = token ? await authenticateBearerToken(env, token) : null;

					if (!authUser) {
						response = errorResponse('Unauthorized', 401);
					} else {
						try {
							await ensureOrganizationSchema(env);

							const protectedContext = createProtectedContext(context, authUser);

							response = await handleAccountRoute(protectedContext)
								?? await handleStatsRoute(protectedContext)
								?? await handleSourceRoute(protectedContext)
								?? await handleApiKeyRoute(protectedContext)
								?? await handleBookmarkRoute(protectedContext)
								?? await handleListRoute(protectedContext)
								?? await handleSmartListRoute(protectedContext)
								?? errorResponse('Not found', 404);
						} catch (error) {
							console.error(error);
							response = errorResponse('Internal Server Error', 500);
						}
					}
				}
			}
		}

		return applyCorsHeaders(response, request);
	},

	async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
		await ensureOrganizationSchema(env);
		if (env.INGEST_QUEUE) {
			const sources = await listActivePollableSources(env);
			await Promise.all(
				sources.map((source) => env.INGEST_QUEUE!.send({
					kind: 'sync_source',
					payload: {
						id: source.id,
						kind: source.kind,
						pollUrl: source.pollUrl,
						userId: source.userId,
					},
				})),
			);
			return;
		}
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
