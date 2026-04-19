import { XMLParser } from 'fast-xml-parser';
import { saveItemContent } from '../storage/items';
import { listActivePollableSources, markSourcePollingResult } from '../storage/sources';
import { validateSafeUrl, type SourceKind, type StorageEnv } from '../storage/shared';

interface FeedEntry {
	publishedAt?: string;
	summary?: string;
	title: string;
	url: string;
}

function stripHtml(value: string): string {
	return value
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) {
		return [];
	}

	return Array.isArray(value) ? value : [value];
}

function firstDefinedString(...values: Array<unknown>): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}

	return undefined;
}

function extractAtomLink(entry: Record<string, unknown>): string | undefined {
	const linkValue = entry.link;
	for (const link of ensureArray(linkValue as Record<string, unknown> | Array<Record<string, unknown>> | undefined)) {
		if (!link || typeof link !== 'object') {
			continue;
		}
		const href = typeof link.href === 'string' ? link.href.trim() : '';
		const rel = typeof link.rel === 'string' ? link.rel.trim() : '';
		if (href && (!rel || rel === 'alternate')) {
			return href;
		}
	}

	return undefined;
}

function parseFeedEntries(xml: string): FeedEntry[] {
	const parser = new XMLParser({
		attributeNamePrefix: '',
		ignoreAttributes: false,
	});
	const parsed = parser.parse(xml) as Record<string, unknown>;

	if (parsed.rss && typeof parsed.rss === 'object') {
		const channel = (parsed.rss as Record<string, unknown>).channel as Record<string, unknown> | undefined;
		const entries: FeedEntry[] = [];
		for (const item of ensureArray(channel?.item as Record<string, unknown> | Array<Record<string, unknown>> | undefined)) {
			const link = firstDefinedString(item.link, item.guid);
			if (!link) {
				continue;
			}

			entries.push({
				publishedAt: firstDefinedString(item.pubDate, item.isoDate),
				summary: firstDefinedString(item.description, item['content:encoded']),
				title: firstDefinedString(item.title) ?? link,
				url: link,
			});
		}
		return entries;
	}

	if (parsed.feed && typeof parsed.feed === 'object') {
		const feed = parsed.feed as Record<string, unknown>;
		const entries: FeedEntry[] = [];
		for (const entry of ensureArray(feed.entry as Record<string, unknown> | Array<Record<string, unknown>> | undefined)) {
			const link = extractAtomLink(entry);
			if (!link) {
				continue;
			}

			entries.push({
				publishedAt: firstDefinedString(entry.updated, entry.published),
				summary: firstDefinedString(entry.summary, entry.content),
				title: firstDefinedString(entry.title) ?? link,
				url: link,
			});
		}
		return entries;
	}

	return [];
}

async function getUsername(env: StorageEnv, userId: string): Promise<string> {
	const user = await env.KEEPROOT_DB.prepare(
		'SELECT username FROM users WHERE id = ? LIMIT 1',
	)
		.bind(userId)
		.first<{ username: string }>();

	return user?.username ?? userId;
}

export async function syncSource(
	env: StorageEnv,
	source: {
		id: string;
		kind: SourceKind;
		name?: string;
		pollUrl: string;
		userId: string;
	},
): Promise<{ discoveredCount: number; savedCount: number }> {
	if (!await validateSafeUrl(source.pollUrl)) {
		const errorText = 'Unsafe source URL';
		await markSourcePollingResult(env, {
			discoveredCount: 0,
			errorText,
			id: source.id,
			runType: 'poll',
			savedCount: 0,
			status: 'error',
		});
		throw new Error(errorText);
	}

	let currentUrl = source.pollUrl;
	let response: Response | null = null;
	let redirectCount = 0;

	while (redirectCount < 5) {
		response = await fetch(currentUrl, {
			headers: {
				Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
				'User-Agent': 'KeepRoot/1.0 (+https://keeproot.local)',
			},
			redirect: 'manual',
		});

		if ([301, 302, 303, 307, 308].includes(response.status)) {
			await response.body?.cancel().catch(() => {});
			const location = response.headers.get('location');
			if (!location) {
				const errorText = 'Redirect missing location header';
				await markSourcePollingResult(env, {
					discoveredCount: 0,
					errorText,
					id: source.id,
					runType: 'poll',
					savedCount: 0,
					status: 'error',
				});
				throw new Error(errorText);
			}
			let nextUrl: string;
			try {
				nextUrl = new URL(location, currentUrl).toString();
			} catch {
				const errorText = 'Invalid redirect URL';
				await markSourcePollingResult(env, {
					discoveredCount: 0,
					errorText,
					id: source.id,
					runType: 'poll',
					savedCount: 0,
					status: 'error',
				});
				throw new Error(errorText);
			}
			if (!await validateSafeUrl(nextUrl)) {
				const errorText = 'Unsafe redirect URL';
				await markSourcePollingResult(env, {
					discoveredCount: 0,
					errorText,
					id: source.id,
					runType: 'poll',
					savedCount: 0,
					status: 'error',
				});
				throw new Error(errorText);
			}
			currentUrl = nextUrl;
			redirectCount += 1;
			continue;
		}
		break;
	}

	if (!response || !response.ok) {
		const errorText = `Failed to fetch source feed (${response?.status ?? 'Unknown'})`;
		await markSourcePollingResult(env, {
			discoveredCount: 0,
			errorText,
			id: source.id,
			runType: 'poll',
			savedCount: 0,
			status: 'error',
		});
		throw new Error(errorText);
	}

	const xml = await response.text();
	const entries = parseFeedEntries(xml);
	const username = await getUsername(env, source.userId);
	let savedCount = 0;

	for (const entry of entries.slice(0, 25)) {
		try {
			const summary = stripHtml(entry.summary ?? '');
			await saveItemContent(
				env,
				{
					userId: source.userId,
					username,
				},
				{
					notes: source.name ? `Saved from source: ${source.name}` : undefined,
					sourceId: source.id,
					status: 'saved',
					textContent: summary || entry.title,
					title: entry.title,
					url: entry.url,
				},
				'source_sync',
			);
			savedCount += 1;
		} catch (error) {
			console.warn('Failed to ingest feed entry', error);
		}
	}

	await markSourcePollingResult(env, {
		discoveredCount: entries.length,
		id: source.id,
		runType: 'poll',
		savedCount,
		status: 'success',
	});

	return {
		discoveredCount: entries.length,
		savedCount,
	};
}

export async function syncAllActiveSources(env: StorageEnv): Promise<void> {
	const sources = await listActivePollableSources(env);
	// ⚡ Bolt: Use Promise.all to sync multiple independent sources concurrently instead of a sequential loop.
	// Impact: Significantly reduces overall background sync latency by overlapping I/O wait times.
	await Promise.all(
		sources.map((source) =>
			syncSource(env, {
				id: source.id,
				kind: source.kind,
				pollUrl: source.pollUrl,
				userId: source.userId,
			}).catch((error) => {
				console.warn('Source sync failed', error);
			})
		)
	);
}
