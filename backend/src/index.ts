import { createMcpHandler } from 'agents/mcp';
import { ingestEmailMessage } from './ingest/email';
import { processIngestJob, type IngestJob } from './ingest/jobs';
import { syncAllActiveSources } from './ingest/source-sync';
import { buildKeepRootMcpServer } from './mcp/server';
import { assertOrganizationSchemaReady, authenticateBearerToken, listActivePollableSources, SchemaCompatibilityError, type StorageEnv } from './storage';
import { corsHeaders, createRouteContext, errorResponse, isProtectedApiPath, resolveCorsOrigin, type ProtectedRouteContext } from './http';
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

function applyCorsHeaders(response: Response, request: Request, env: Env): Response {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(corsHeaders)) {
		headers.set(key, value);
	}

	const allowedOrigin = resolveCorsOrigin(request, env);
	if (allowedOrigin) {
		headers.set('Access-Control-Allow-Origin', allowedOrigin);
		headers.set('Vary', 'Origin');
	}

	// Sentinel: Add security headers to prevent XSS, MIME sniffing, and clickjacking
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('X-Frame-Options', 'DENY');
	headers.set('X-XSS-Protection', '1; mode=block');
	const pathname = new URL(request.url).pathname;
	if (pathname === '/mcp' || pathname.startsWith('/auth/') || isProtectedApiPath(pathname)) {
		headers.set('Cache-Control', 'no-store');
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function handleFetchError(error: unknown): Response {
	console.error(error);
	if (error instanceof SchemaCompatibilityError) {
		return errorResponse(error.message, 503);
	}
	return errorResponse('Internal Server Error', 500);
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
					await assertOrganizationSchemaReady(env);
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
					response = handleFetchError(error);
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
							await assertOrganizationSchemaReady(env);

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
							response = handleFetchError(error);
						}
					}
				}
			}
		}

		return applyCorsHeaders(response, request, env);
	},

	async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
		await assertOrganizationSchemaReady(env);
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
		await assertOrganizationSchemaReady(env);
		for (const message of batch.messages) {
			await processIngestJob(env, message.body);
		}
	},

	async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
		await assertOrganizationSchemaReady(env);
		await ingestEmailMessage(env, message);
	},
};
