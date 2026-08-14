import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { maybeQueueSourceSync } from './source-sync';
import { addSource, listSources, removeSource } from '../storage/sources';
import { getUsageStats, recordToolEvent } from '../storage/stats';
import { getWhoAmI } from '../storage/account';
import { listInbox, markInboxDone } from '../storage/inbox';
import { getItem, listItems, searchItems, updateItem } from '../storage/items';
import { saveItemFromUrl } from '../ingest/save-url';
import type { IngestJob } from '../ingest/jobs';
import { ITEM_STATUSES, type AuthenticatedUser, type StorageEnv } from '../storage/shared';

type ToolHandler<TArgs> = (args: TArgs) => Promise<Record<string, unknown>>;
type ToolSchema<TArgs extends Record<string, unknown>> = z.ZodType<TArgs>;

export type RegisterToolFn = <TArgs extends Record<string, unknown>>(
	name: string,
	description: string,
	inputSchema: ToolSchema<TArgs>,
	handler: ToolHandler<TArgs>,
) => void;

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

function registerItemTools(registerTool: RegisterToolFn, env: StorageEnv, user: AuthenticatedUser) {
	registerTool(
		'save_item',
		'Save a new item from a URL.',
		z.object({
			captureScreenshot: z.boolean().default(false).optional()
				.describe('Capture a rendered viewport image and store it with the item. This also enables browser rendering.'),
			notes: z.string().optional()
				.describe('Free-text note to attach to the saved item.'),
			render: z.boolean().optional()
				.describe('Set true to force browser rendering or false to disable the automatic JavaScript-shell fallback.'),
			status: z.enum(ITEM_STATUSES).optional()
				.describe('Initial lifecycle status. Defaults to "saved"; pass "archived" to save without adding it to the active library.'),
			tags: z.array(z.string()).optional()
				.describe('Tags to attach to the saved item.'),
			title: z.string().optional()
				.describe('Overrides the title extracted from the page.'),
			url: z.string().url()
				.describe('The http(s) URL to save. Private, local, and reserved network targets are rejected.'),
			waitForProcessing: z.boolean().default(true).optional()
				.describe('When true (default) the save completes before returning. Set false to queue it and return immediately with processingState "queued".'),
		}),
		async (args) => {
			if (args.waitForProcessing === false && env.INGEST_QUEUE) {
				const job: IngestJob = {
					kind: 'save_url',
					payload: {
						captureScreenshot: args.captureScreenshot,
						notes: args.notes,
						render: args.render,
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
				captureScreenshot: args.captureScreenshot,
				notes: args.notes,
				render: args.render,
				status: args.status,
				tags: args.tags,
				title: args.title,
				url: args.url,
			});
		},
	);

	registerTool(
		'search_items',
		'Search saved items by keyword and semantic similarity, best match first. Returns '
			+ 'metadata plus score and matchReason ("keyword" | "semantic" | "hybrid") — not article '
			+ 'text. Set includeContent to add full body text, which is very large. Filters apply '
			+ 'on top of the query and combine with AND. Not paginated; raise limit instead.',
		z.object({
			domain: z.string().optional()
				.describe('Exact hostname match, e.g. "example.com". Not a suffix or wildcard match.'),
			includeContent: z.boolean().default(false).optional()
				.describe('Include each result\'s full extracted body text. Off by default because it is very large.'),
			isRead: z.boolean().optional()
				.describe('Filter by read state. Omit for both. Note this is separate from status.'),
			limit: z.number().int().min(1).max(50).default(10).optional()
				.describe('Maximum results, 1-50. Defaults to 10.'),
			listId: z.string().nullable().optional()
				.describe('Filter to one list id. Pass null to match only items in no list. Omit for all.'),
			pinned: z.boolean().optional()
				.describe('Filter by pinned state. Omit for both.'),
			query: z.string().min(1)
				.describe('Free-text search string. Matched against title, tags, and extracted body text.'),
			sourceId: z.string().nullable().optional()
				.describe('Filter to one source id. Pass null to match only manually saved items. Omit for all.'),
			status: z.enum(ITEM_STATUSES).optional()
				.describe('Item lifecycle status. "saved" (the default for new items) means in the library; "archived" means triaged out. Omit to search both.'),
			tags: z.array(z.string()).optional()
				.describe('Items must carry every tag listed (AND, not OR). Case-insensitive.'),
		}),
		async (args) => searchItems(env, user.userId, args),
	);

	registerTool(
		'list_items',
		'List saved items, newest first, with optional filters. Returns metadata only '
			+ '(id, title, url, domain, tags, status, isRead, pinned, excerpt, wordCount, dates) — '
			+ 'not article text. Set includeContent to add the full extracted body, which can be '
			+ 'tens of thousands of words per item; prefer get_item for reading a specific article. '
			+ 'Filters combine with AND and match exactly. Paginate by passing the returned '
			+ 'nextCursor back as cursor; nextCursor is null on the last page.',
		z.object({
			cursor: z.string().optional()
				.describe('Opaque pagination cursor from a previous response\'s nextCursor. Omit for the first page.'),
			domain: z.string().optional()
				.describe('Exact hostname match, e.g. "example.com". Not a suffix or wildcard match.'),
			includeContent: z.boolean().default(false).optional()
				.describe('Include each item\'s full extracted body text. Off by default because it is very large; use get_item for single articles.'),
			isRead: z.boolean().optional()
				.describe('Filter by read state. Omit for both. Note this is separate from status.'),
			limit: z.number().int().min(1).max(100).default(20).optional()
				.describe('Items per page, 1-100. Defaults to 20.'),
			listId: z.string().nullable().optional()
				.describe('Filter to one list id. Pass null to match only items in no list. Omit for all.'),
			pinned: z.boolean().optional()
				.describe('Filter by pinned state. Omit for both.'),
			sourceId: z.string().nullable().optional()
				.describe('Filter to one source id. Pass null to match only manually saved items. Omit for all.'),
			status: z.enum(ITEM_STATUSES).optional()
				.describe('Item lifecycle status. "saved" (the default for new items) means in the library; "archived" means triaged out. Omit to return both.'),
			tags: z.array(z.string()).optional()
				.describe('Items must carry every tag listed (AND, not OR). Case-insensitive.'),
		}),
		async (args) => listItems(env, user.userId, args),
	);

	registerTool(
		'get_item',
		'Fetch one item by id. Returns metadata only by default; set includeContent to get the '
			+ 'extracted article as Markdown. This is the right tool for reading a single article — '
			+ 'use it instead of asking list_items for content across many items.',
		z.object({
			id: z.string()
				.describe('The item id, as returned by list_items, search_items, or save_item.'),
			includeContent: z.boolean().default(false).optional()
				.describe('Include the extracted article as Markdown in markdownData.'),
			includeHtml: z.boolean().default(false).optional()
				.describe('Include the raw HTML snapshot in htmlData, when one was stored. Much larger than the Markdown; rarely needed.'),
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
		'Update the title, notes, tags, or status of one item. Only the fields you pass are '
			+ 'changed. Returns the updated item\'s metadata as confirmation, without article '
			+ 'text — call get_item if you need the content back.',
		z.object({
			id: z.string()
				.describe('The item id, as returned by list_items, search_items, or save_item.'),
			notes: z.string().nullable().optional()
				.describe('Replaces any existing note. Pass null to clear it.'),
			status: z.enum(ITEM_STATUSES).optional()
				.describe('Set the item\'s lifecycle status. "saved" means in the library; "archived" means triaged out. New items start as "saved".'),
			tags: z.array(z.string()).optional()
				.describe('Replaces the item\'s tags entirely — it does not append. Pass the full desired set.'),
			title: z.string().optional()
				.describe('Replaces the item title.'),
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
}

function registerAccountTools(registerTool: RegisterToolFn, env: StorageEnv, user: AuthenticatedUser) {
	registerTool(
		'whoami',
		'Get the current account and plan details.',
		z.object({}),
		async () => getWhoAmI(env, user),
	);

	registerTool(
		'get_stats',
		'Get usage stats for the current account.',
		z.object({}),
		async () => getUsageStats(env, user.userId),
	);
}

function registerSourceTools(registerTool: RegisterToolFn, env: StorageEnv, user: AuthenticatedUser) {
	registerTool(
		'list_sources',
		'List configured content sources and subscriptions.',
		z.object({
			cursor: z.string().nullable().optional(),
			kind: z.enum(['browser', 'rss', 'youtube', 'x', 'email']).optional(),
			limit: z.number().int().min(1).max(100).default(20).optional(),
			status: z.string().optional(),
		}),
		async (args) => listSources(env, user.userId, args),
	);

	registerTool(
		'add_source',
		'Add an RSS, YouTube, X, email, or Agentic scraping source.',
		z.object({
			config: z.record(z.string(), z.unknown()).optional(),
			identifier: z.string().min(1),
			kind: z.enum(['browser', 'rss', 'youtube', 'x', 'email']),
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
}

function registerInboxTools(registerTool: RegisterToolFn, env: StorageEnv, user: AuthenticatedUser) {
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

	registerItemTools(registerTool, env, user);
	registerAccountTools(registerTool, env, user);
	registerSourceTools(registerTool, env, user);
	registerInboxTools(registerTool, env, user);

	return server;
}
