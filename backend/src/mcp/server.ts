import { createMcpHandler } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAccountProfile, getAccountStats, listInboxEntries, listSources, markInboxEntryDone, recordToolUsage, removeSource, saveItem, searchItems, updateItem, listItems, getItem, addSource, type AuthenticatedUser, type StorageEnv } from '../storage';

function jsonToolResult(data: Record<string, unknown>) {
	return {
		content: [
			{
				text: JSON.stringify(data),
				type: 'text' as const,
			},
		],
		structuredContent: data,
	};
}

function normalizeCommonFilters(input: {
	created_after?: string;
	created_before?: string;
	cursor?: string;
	domain?: string;
	is_read?: boolean;
	limit?: number;
	list_id?: string | null;
	pinned?: boolean;
	source_id?: string;
	status?: string;
	tags?: string[];
}) {
	return {
		createdAfter: input.created_after,
		createdBefore: input.created_before,
		cursor: input.cursor,
		domain: input.domain,
		isRead: input.is_read,
		limit: input.limit,
		listId: input.list_id,
		pinned: input.pinned,
		sourceId: input.source_id,
		status: input.status,
		tags: input.tags,
	};
}

function createServer(env: StorageEnv, authUser: AuthenticatedUser): McpServer {
	const server = new McpServer({
		name: 'keeproot',
		version: '1.0.0',
	});

	async function runTrackedTool(toolName: string, fn: () => Promise<Record<string, unknown>>) {
		const startedAt = Date.now();
		try {
			const result = await fn();
			await recordToolUsage(env, authUser.userId, {
				latencyMs: Date.now() - startedAt,
				status: 'success',
				toolName,
			});
			return jsonToolResult(result);
		} catch (error) {
			await recordToolUsage(env, authUser.userId, {
				latencyMs: Date.now() - startedAt,
				status: 'failure',
				toolName,
			});
			throw error;
		}
	}

	server.registerTool(
		'save_item',
		{
			description: 'Save a new item from a URL, extract content, and place it in the inbox.',
			inputSchema: z.object({
				notes: z.string().trim().optional(),
				status: z.string().trim().optional(),
				tags: z.array(z.string().trim()).optional(),
				title: z.string().trim().optional(),
				url: z.string().url(),
			}),
		},
		async (args) => runTrackedTool('save_item', () => saveItem(env, authUser, args)),
	);

	server.registerTool(
		'search_items',
		{
			description: 'Search your saved items by keyword and filters.',
			inputSchema: z.object({
				created_after: z.string().datetime().optional(),
				created_before: z.string().datetime().optional(),
				domain: z.string().trim().optional(),
				is_read: z.boolean().optional(),
				limit: z.number().int().min(1).max(50).optional(),
				list_id: z.string().trim().nullable().optional(),
				mode: z.enum(['hybrid', 'keyword', 'semantic']).optional(),
				pinned: z.boolean().optional(),
				query: z.string().trim().optional(),
				source_id: z.string().trim().optional(),
				status: z.string().trim().optional(),
				tags: z.array(z.string().trim()).optional(),
			}),
		},
		async (args) => runTrackedTool('search_items', () => searchItems(env, authUser.userId, {
			...normalizeCommonFilters(args),
			mode: args.mode,
			query: args.query,
		})),
	);

	server.registerTool(
		'list_items',
		{
			description: 'List your saved items with cursor pagination and filters.',
			inputSchema: z.object({
				created_after: z.string().datetime().optional(),
				created_before: z.string().datetime().optional(),
				cursor: z.string().optional(),
				domain: z.string().trim().optional(),
				is_read: z.boolean().optional(),
				limit: z.number().int().min(1).max(100).optional(),
				list_id: z.string().trim().nullable().optional(),
				pinned: z.boolean().optional(),
				source_id: z.string().trim().optional(),
				status: z.string().trim().optional(),
				tags: z.array(z.string().trim()).optional(),
			}),
		},
		async (args) => runTrackedTool('list_items', () => listItems(env, authUser.userId, normalizeCommonFilters(args))),
	);

	server.registerTool(
		'get_item',
		{
			description: 'Fetch a single item by id with optional content.',
			inputSchema: z.object({
				include_content: z.boolean().optional(),
				include_html: z.boolean().optional(),
				item_id: z.string().trim(),
			}),
		},
		async (args) => runTrackedTool('get_item', async () => {
			const item = await getItem(env, authUser.userId, args.item_id, {
				includeContent: args.include_content,
				includeHtml: args.include_html,
			});
			if (!item) {
				throw new Error('Item not found');
			}
			return { item };
		}),
	);

	server.registerTool(
		'update_item',
		{
			description: 'Update an item title, notes, tags, or status.',
			inputSchema: z.object({
				item_id: z.string().trim(),
				notes: z.string().trim().nullable().optional(),
				status: z.string().trim().optional(),
				tags: z.array(z.string().trim()).optional(),
				title: z.string().trim().optional(),
			}),
		},
		async (args) => runTrackedTool('update_item', async () => {
			const item = await updateItem(env, authUser.userId, args.item_id, {
				notes: args.notes,
				status: args.status,
				tags: args.tags,
				title: args.title,
			});
			if (!item) {
				throw new Error('Item not found');
			}
			return { item };
		}),
	);

	server.registerTool(
		'whoami',
		{
			description: 'Return the current account identity, plan, limits, and enabled source capabilities.',
			inputSchema: z.object({}),
		},
		async () => runTrackedTool('whoami', async () => ({
			account: await getAccountProfile(env, authUser),
		})),
	);

	server.registerTool(
		'list_sources',
		{
			description: 'List the content sources configured for this account.',
			inputSchema: z.object({
				include_disabled: z.boolean().optional(),
			}),
		},
		async (args) => runTrackedTool('list_sources', async () => ({
			sources: await listSources(env, authUser.userId, { includeDisabled: args.include_disabled }),
		})),
	);

	server.registerTool(
		'add_source',
		{
			description: 'Add a content source such as RSS, YouTube, X, or email.',
			inputSchema: z.object({
				identifier: z.string().trim().optional(),
				kind: z.enum(['rss', 'youtube', 'x', 'email']),
				name: z.string().trim().optional(),
			}),
		},
		async (args) => runTrackedTool('add_source', async () => ({
			source: await addSource(env, authUser.userId, args),
		})),
	);

	server.registerTool(
		'remove_source',
		{
			description: 'Disable a configured content source.',
			inputSchema: z.object({
				source_id: z.string().trim(),
			}),
		},
		async (args) => runTrackedTool('remove_source', async () => {
			const source = await removeSource(env, authUser.userId, args.source_id);
			if (!source) {
				throw new Error('Source not found');
			}
			return { source };
		}),
	);

	server.registerTool(
		'get_stats',
		{
			description: 'Return account usage, inbox, source, and tool usage stats.',
			inputSchema: z.object({}),
		},
		async () => runTrackedTool('get_stats', async () => ({
			stats: await getAccountStats(env, authUser.userId),
		})),
	);

	server.registerTool(
		'list_inbox',
		{
			description: 'List pending inbox entries and their linked items.',
			inputSchema: z.object({
				limit: z.number().int().min(1).max(100).optional(),
				source_id: z.string().trim().optional(),
			}),
		},
		async (args) => runTrackedTool('list_inbox', async () => ({
			entries: await listInboxEntries(env, authUser.userId, {
				limit: args.limit,
				sourceId: args.source_id,
			}),
		})),
	);

	server.registerTool(
		'mark_done',
		{
			description: 'Mark an inbox entry as processed without deleting its underlying item.',
			inputSchema: z.object({
				inbox_entry_id: z.string().trim(),
			}),
		},
		async (args) => runTrackedTool('mark_done', async () => {
			const entry = await markInboxEntryDone(env, authUser.userId, args.inbox_entry_id);
			if (!entry) {
				throw new Error('Inbox entry not found');
			}
			return { entry };
		}),
	);

	return server;
}

export function createKeepRootMcpHandler(env: StorageEnv, authUser: AuthenticatedUser) {
	return createMcpHandler(createServer(env, authUser) as never, {
		enableJsonResponse: true,
		route: '/mcp',
	});
}
