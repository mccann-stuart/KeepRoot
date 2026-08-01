import { createMcpHandler } from 'agents/mcp/server';
import { ingestEmailMessage } from './ingest/email';
import { processIngestJob, type IngestJob } from './ingest/jobs';
import { syncAllActiveSources } from './ingest/source-sync';
import { buildKeepRootMcpServer } from './mcp/server';
import { assertOrganizationSchemaReady, authenticateBearerToken, listActivePollableSources, SchemaCompatibilityError, type StorageEnv } from './storage';
import { appendVaryHeader, corsHeaders, createRouteContext, enforceRateLimit, errorResponse, isProtectedApiPath, resolveCorsOrigin, type ProtectedRouteContext } from './http';
import { handleAuthRoute, handleProtectedAuthRoute } from './routes/auth';
import { handleAccountRoute } from './routes/account';
import { handleApiKeyRoute } from './routes/api-keys';
import { handleBookmarkRoute } from './routes/bookmarks';
import { handleListRoute } from './routes/lists';
import { handleProtectedStoredObjectRoute, handlePublicRoute } from './routes/public';
import { handleSmartListRoute } from './routes/smart-lists';
import { handleSourceRoute } from './routes/sources';
import { handleStatsRoute } from './routes/stats';

export interface Env extends StorageEnv {}

const PUBLIC_AUTH_RATE_LIMIT_PATHS = new Set([
	'/auth/generate-authentication',
	'/auth/generate-registration',
	'/auth/verify-authentication',
	'/auth/verify-registration',
]);

function getConnectingIp(request: Request): string {
	return request.headers.get('CF-Connecting-IP')?.trim() || 'unknown';
}

async function getMcpWriteAction(request: Request): Promise<string | null> {
	try {
		const body = await request.clone().json<unknown>();
		const messages = Array.isArray(body) ? body : [body];
		for (const message of messages) {
			if (!message || typeof message !== 'object') {
				continue;
			}

			const params = (message as { params?: unknown }).params;
			if (!params || typeof params !== 'object') {
				continue;
			}

			const name = (params as { name?: unknown }).name;
			if (name === 'save_item') {
				return 'mcp-save-item';
			}

			const args = (params as { arguments?: unknown }).arguments;
			if (name === 'add_source'
				&& (!args || typeof args !== 'object' || (args as { syncNow?: unknown }).syncNow !== false)) {
				return 'mcp-source-sync';
			}
		}
	} catch {
		// The MCP handler owns malformed-request responses.
	}

	return null;
}

async function getProtectedWriteAction(context: ReturnType<typeof createRouteContext>): Promise<string | null> {
	if (context.request.method !== 'POST') {
		return null;
	}

	if (context.pathname === '/bookmarks') {
		return 'bookmark-save';
	}

	if (context.pathname === '/sources') {
		try {
			const body = await context.request.clone().json<{ syncNow?: unknown }>();
			return body.syncNow === false ? null : 'source-sync';
		} catch {
			return 'source-sync';
		}
	}

	return null;
}

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
		appendVaryHeader(headers, 'Origin');
	}

	// Sentinel: Add security headers to prevent XSS, MIME sniffing, and clickjacking
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('X-Frame-Options', 'DENY');
	headers.set('X-XSS-Protection', '1; mode=block');
	headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; form-action 'self';");
	headers.set('Referrer-Policy', 'no-referrer');
	headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
	headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	headers.set('Cross-Origin-Resource-Policy', 'same-origin');
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
		const authRateLimitResponse = request.method === 'POST' && PUBLIC_AUTH_RATE_LIMIT_PATHS.has(context.pathname)
			? await enforceRateLimit(env.AUTH_RATE_LIMITER, getConnectingIp(request), context.pathname)
			: null;

		if (authRateLimitResponse) {
			response = authRateLimitResponse;
		} else if (context.pathname === '/mcp') {
			const authHeader = request.headers.get('Authorization');
			const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
			const authUser = token ? await authenticateBearerToken(env, token) : null;

			if (!authUser) {
				response = errorResponse('Unauthorized', 401);
			} else {
				try {
					const writeAction = await getMcpWriteAction(request);
					const rateLimitResponse = writeAction
						? await enforceRateLimit(env.WRITE_RATE_LIMITER, `${authUser.userId}:${writeAction}`, writeAction)
						: null;
					if (rateLimitResponse) {
						response = rateLimitResponse;
					} else {
						await assertOrganizationSchemaReady(env);
						const handler = createMcpHandler(() => buildKeepRootMcpServer(env, authUser), {
							authContext: {
								props: {
									tokenType: authUser.tokenType,
									userId: authUser.userId,
									username: authUser.username,
								},
							},
							corsOptions: false,
							legacy: 'stateless',
							responseMode: 'json',
							route: '/mcp',
						});
						response = await handler(request, env, ctx);
					}
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
							const writeAction = await getProtectedWriteAction(context);
							const rateLimitResponse = writeAction
								? await enforceRateLimit(env.WRITE_RATE_LIMITER, `${authUser.userId}:${writeAction}`, writeAction)
								: null;
							if (rateLimitResponse) {
								response = rateLimitResponse;
							} else {
								await assertOrganizationSchemaReady(env);

								const protectedContext = createProtectedContext(context, authUser);

								response = await handleProtectedAuthRoute(protectedContext)
									?? await handleProtectedStoredObjectRoute(protectedContext)
									?? await handleAccountRoute(protectedContext)
									?? await handleStatsRoute(protectedContext)
									?? await handleSourceRoute(protectedContext)
									?? await handleApiKeyRoute(protectedContext)
									?? await handleBookmarkRoute(protectedContext)
									?? await handleListRoute(protectedContext)
									?? await handleSmartListRoute(protectedContext)
									?? errorResponse('Not found', 404);
							}
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
		// ⚡ Bolt: Execute queue messages concurrently to maximize throughput and reduce total batch latency.
		// Using Promise.allSettled ensures all messages are processed even if one fails. We throw the first rejection
		// to allow the queue consumer to retry the failed messages while preventing the entire batch from hanging.
		const results = await Promise.allSettled(
			batch.messages.map((message) => processIngestJob(env, message.body)),
		);

		const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
		if (failed) {
			throw failed.reason;
		}
	},

	async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
		await assertOrganizationSchemaReady(env);
		await ingestEmailMessage(env, message);
	},
};
