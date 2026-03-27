import { errorResponse, jsonResponse, parseJson, type ProtectedRouteContext } from '../http';
import { maybeQueueSourceSync } from '../mcp/source-sync';
import { addSource, listSources, removeSource, type SourceKind } from '../storage';

function parseLimit(value: string | null): number | undefined {
	if (!value) {
		return undefined;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export async function handleSourceRoute(context: ProtectedRouteContext): Promise<Response | undefined> {
	if (context.request.method === 'GET' && context.pathname === '/sources') {
		const query = context.url.searchParams;
		const sources = await listSources(context.env, context.authUser.userId, {
			cursor: query.get('cursor'),
			kind: (query.get('kind') as SourceKind | null) ?? undefined,
			limit: parseLimit(query.get('limit')),
			status: query.get('status') ?? undefined,
		});
		return jsonResponse(sources);
	}

	if (context.request.method === 'POST' && context.pathname === '/sources') {
		const body = await parseJson<{
			bridgeUrl?: string;
			config?: Record<string, unknown>;
			identifier?: string;
			kind?: SourceKind;
			name?: string;
			syncNow?: boolean;
		}>(context.request);
		const kind = body.kind;
		const identifier = body.identifier?.trim();

		if (!kind || !identifier) {
			return errorResponse('Kind and identifier required', 400);
		}

		const config = {
			...(body.config ?? {}),
			...(body.bridgeUrl?.trim() ? { bridgeUrl: body.bridgeUrl.trim() } : {}),
		};

		try {
			const source = await addSource(context.env, {
				config,
				identifier,
				kind,
				name: body.name?.trim() || undefined,
				userId: context.authUser.userId,
			});

			if (body.syncNow !== false) {
				await maybeQueueSourceSync(context.env, {
					...source,
					userId: context.authUser.userId,
				});
			}

			return jsonResponse(source, 201);
		} catch (error) {
			if (error instanceof Error && error.name === 'ValidationError') {
				return errorResponse(error.message, 400);
			}
			console.error(error);
			return errorResponse('Failed to create source', 500);
		}
	}

	if (context.request.method === 'DELETE' && context.pathname.startsWith('/sources/')) {
		const sourceId = context.pathname.slice('/sources/'.length);
		if (!sourceId) {
			return errorResponse('Missing ID', 400);
		}

		const removed = await removeSource(context.env, context.authUser.userId, sourceId);
		if (!removed) {
			return errorResponse('Not found', 404);
		}

		return jsonResponse({ removed: true });
	}

	return undefined;
}
