import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { addSource, listSources, removeSource } from '../storage/sources';
import { getUsageStats, recordToolEvent } from '../storage/stats';
import { getWhoAmI } from '../storage/account';
import { listInbox, markInboxDone } from '../storage/inbox';
import { getItem, listItems, searchItems, updateItem } from '../storage/items';
import { saveItemFromUrl } from '../ingest/save-url';
import { syncSource } from '../ingest/source-sync';
import type { AuthenticatedUser, SourceKind, StorageEnv } from '../storage/shared';
import type { IngestJob } from '../ingest/jobs';

type ToolHandler<TArgs> = (args: TArgs) => Promise<Record<string, unknown>>;
type ToolSchema<TArgs extends Record<string, unknown>> = z.ZodType<TArgs>;

function formatToolResult(payload: Record<string, unknown>) {
	return {
		content: [
			{
				type: 'text' as const,
				text: JSON.stringify(payload, null, 2),
			},
		],
		structuredContent: payload,
	};
}

function normalizeErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function maybeQueueSourceSync(
	env: StorageEnv,
	source: Record<string, unknown>,
): Promise<void> {
	const pollUrl = typeof source.pollUrl === 'string' ? source.pollUrl : null;
	const kind = typeof source.kind === 'string' ? source.kind as SourceKind : null;
	const id = typeof source.id === 'string' ? source.id : null;
	const userId = typeof (source as { userId?: unknown }).userId === 'string' ? (source as { userId: string }).userId : null;

	if (!id || !kind || !pollUrl || !userId) {
		return;
	}

	if (env.INGEST_QUEUE) {
		const job: IngestJob = {
			kind: 'sync_source',
			payload: {
				id,
				kind,
				pollUrl,
				userId,
			},
		};
		await env.INGEST_QUEUE.send(job);
		return;
	}

	await syncSource(env, {
		id,
		kind,
		pollUrl,
		userId,
	});
}

export function buildKeepRootMcpServer(env: StorageEnv, user: AuthenticatedUser): McpServer {
	const server = new McpServer({
		name: 'keeproot-mcp',
		version: '1.0.0',
	});

	function registerTool<TArgs extends Record<string, unknown>>(
		name: string,
		description: string,
		inputSchema: ToolSchema<TArgs>,
		handler: ToolHandler<TArgs>,
	): void {
		server.registerTool(name, {
			description,
			inputSchema,
		}, async (args) => {
			const startedAt = Date.now();
			try {
				const result = await handler(args);
				await recordToolEvent(env, {
					durationMs: Date.now() - startedAt,
					status: 'success',
					toolName: name,
					userId: user.userId,
				});
				return formatToolResult(result);
			} catch (error) {
				await recordToolEvent(env, {
					durationMs: Date.now() - startedAt,
					errorText: normalizeErrorMessage(error),
					status: 'error',
					toolName: name,
					userId: user.userId,
				});
				throw error;
			}
		});
	}

	registerTool(
		'save_item',
		'Save a new item from a URL.',
		z.object({
			notes: z.string().optional(),
			status: z.string().optional(),
			tags: z.array(z.string()).optional(),
			title: z.string().optional(),
			url: z.string().url(),
			waitForProcessing: z.boolean().default(true).optional(),
		}),
		async (args) => {
			if (args.waitForProcessing === false && env.INGEST_QUEUE) {
				const job: IngestJob = {
					kind: 'save_url',
					payload: {
						notes: args.notes,
						status: args.status,
						tags: args.tags,
						title: args.title,
						url: args.url,
						userId: user.userId,
						username: user.username,
					},
				};
				await env.INGEST_QUEUE.send(job);
				return {
					processingState: 'queued',
					url: args.url,
				};
			}

			return saveItemFromUrl(env, user, {
				notes: args.notes,
				status: args.status,
				tags: args.tags,
				title: args.title,
				url: args.url,
			});
		},
	);

	registerTool(
		'search_items',
		'Search items by keyword and semantic similarity.',
		z.object({
			domain: z.string().optional(),
			isRead: z.boolean().optional(),
			limit: z.number().int().min(1).max(50).default(10).optional(),
			listId: z.string().nullable().optional(),
			pinned: z.boolean().optional(),
			query: z.string().min(1),
			sourceId: z.string().nullable().optional(),
			status: z.union([z.string(), z.array(z.string())]).optional(),
			tags: z.array(z.string()).optional(),
		}),
		async (args) => searchItems(env, user.userId, args),
	);

	registerTool(
		'list_items',
		'List saved items with optional filters.',
		z.object({
			cursor: z.string().nullable().optional(),
			domain: z.string().optional(),
			isRead: z.boolean().optional(),
			limit: z.number().int().min(1).max(100).default(20).optional(),
			listId: z.string().nullable().optional(),
			pinned: z.boolean().optional(),
			sourceId: z.string().nullable().optional(),
			status: z.union([z.string(), z.array(z.string())]).optional(),
			tags: z.array(z.string()).optional(),
		}),
		async (args) => listItems(env, user.userId, args),
	);

	registerTool(
		'get_item',
		'Get a single item by id with optional content.',
		z.object({
			id: z.string(),
			includeContent: z.boolean().default(false).optional(),
			includeHtml: z.boolean().default(false).optional(),
		}),
		async (args) => {
			const item = await getItem(env, user.userId, args.id, {
				includeContent: args.includeContent,
				includeHtml: args.includeHtml,
			});
			if (!item) {
				throw new Error('Item not found');
			}

			return item;
		},
	);

	registerTool(
		'update_item',
		'Update title, notes, tags, or status of an item.',
		z.object({
			id: z.string(),
			notes: z.string().nullable().optional(),
			status: z.string().optional(),
			tags: z.array(z.string()).optional(),
			title: z.string().optional(),
		}),
		async (args) => {
			const item = await updateItem(env, user.userId, args.id, {
				notes: args.notes,
				status: args.status,
				tags: args.tags,
				title: args.title,
			});
			if (!item) {
				throw new Error('Item not found');
			}

			return item;
		},
	);

	registerTool(
		'whoami',
		'Get the current account and plan details.',
		z.object({}),
		async () => getWhoAmI(env, user),
	);

	registerTool(
		'list_sources',
		'List configured content sources and subscriptions.',
		z.object({
			cursor: z.string().nullable().optional(),
			kind: z.enum(['rss', 'youtube', 'x', 'email']).optional(),
			limit: z.number().int().min(1).max(100).default(20).optional(),
			status: z.string().optional(),
		}),
		async (args) => listSources(env, user.userId, args),
	);

	registerTool(
		'add_source',
		'Add a content source like RSS, YouTube, X, or email.',
		z.object({
			config: z.record(z.string(), z.unknown()).optional(),
			identifier: z.string().min(1),
			kind: z.enum(['rss', 'youtube', 'x', 'email']),
			name: z.string().optional(),
			syncNow: z.boolean().default(true).optional(),
		}),
		async (args) => {
			const source = await addSource(env, {
				config: args.config,
				identifier: args.identifier,
				kind: args.kind,
				name: args.name,
				userId: user.userId,
			}) as Record<string, unknown>;

			if (args.syncNow !== false) {
				await maybeQueueSourceSync(env, {
					...source,
					userId: user.userId,
				});
			}

			return source;
		},
	);

	registerTool(
		'remove_source',
		'Remove a source.',
		z.object({
			id: z.string(),
		}),
		async (args) => {
			const removed = await removeSource(env, user.userId, args.id);
			if (!removed) {
				throw new Error('Source not found');
			}

			return {
				id: args.id,
				removed: true,
			};
		},
	);

	registerTool(
		'get_stats',
		'Get usage stats for the current account.',
		z.object({}),
		async () => getUsageStats(env, user.userId),
	);

	registerTool(
		'list_inbox',
		'List unprocessed inbox items.',
		z.object({
			cursor: z.string().nullable().optional(),
			limit: z.number().int().min(1).max(100).default(20).optional(),
		}),
		async (args) => listInbox(env, user.userId, args),
	);

	registerTool(
		'mark_done',
		'Mark an inbox item as processed.',
		z.object({
			id: z.string(),
		}),
		async (args) => {
			const updated = await markInboxDone(env, user.userId, args.id);
			if (!updated) {
				throw new Error('Inbox entry not found');
			}

			return {
				id: args.id,
				state: 'done',
			};
		},
	);

	return server;
}
