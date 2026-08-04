import { XMLParser } from 'fast-xml-parser';
import { DOMParser } from 'linkedom';
import TurndownService from 'turndown';
import { saveItemContent } from '../storage/items';
import { listActivePollableSources, markSourcePollingResult } from '../storage/sources';
import { validateSafeUrl, type SourceKind, type StorageEnv } from '../storage/shared';

interface FeedEntry {
	content?: string;
	id: string;
	publishedAt?: string;
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
		const text = typeof value === 'string'
			? value
			: value && typeof value === 'object'
				? (value as Record<string, unknown>)['#text']
				: undefined;
		if (typeof text === 'string' && text.trim()) {
			return text.trim();
		}
	}

	return undefined;
}

function extractEntryContent(entry: FeedEntry): { markdownData: string; textContent: string } {
	const rawContent = entry.content?.trim() || entry.title;
	if (!/<[a-z][\s\S]*>/i.test(rawContent)) {
		return {
			markdownData: rawContent,
			textContent: rawContent,
		};
	}

	try {
		const document = new DOMParser().parseFromString(`<article>${rawContent}</article>`, 'text/html');
		const article = document.querySelector('article');
		if (!article) {
			throw new Error('Feed content did not produce an article root');
		}
		for (const element of article.querySelectorAll('script, style')) {
			element.remove();
		}

		const textContent = article.textContent?.replace(/\s+/g, ' ').trim() || stripHtml(rawContent) || entry.title;
		const markdownData = new TurndownService({
			codeBlockStyle: 'fenced',
			headingStyle: 'atx',
		}).turndown(article).trim();

		return {
			markdownData: markdownData || textContent,
			textContent,
		};
	} catch {
		const textContent = stripHtml(rawContent) || entry.title;
		return {
			markdownData: textContent,
			textContent,
		};
	}
}

function getSourceLabel(source: { kind: SourceKind; name?: string; pollUrl: string }): string {
	const name = source.name?.trim();
	if (name) {
		return name;
	}

	try {
		return new URL(source.pollUrl).hostname.replace(/^www\./, '');
	} catch {
		return source.kind.toUpperCase();
	}
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
			const id = firstDefinedString(item.guid, item.link) ?? link;

			entries.push({
				content: firstDefinedString(item['content:encoded'], item.description),
				id,
				publishedAt: firstDefinedString(item.pubDate, item.isoDate),
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
				content: firstDefinedString(entry.content, entry.summary),
				id: firstDefinedString(entry.id, link) ?? link,
				publishedAt: firstDefinedString(entry.updated, entry.published),
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
	if (!(await validateSafeUrl(source.pollUrl))) {
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
				const errorText = 'Invalid redirect location URL';
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
			if (!(await validateSafeUrl(nextUrl))) {
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

	// ⚡ Bolt: Use Promise.allSettled to process feed entries concurrently.
	// Impact: Significantly reduces ingestion time by making independent external API/DB calls concurrently instead of sequentially.
	const results = await Promise.allSettled(
		entries.slice(0, 25).map(async (entry) => {
			const content = extractEntryContent(entry);
			await saveItemContent(
				env,
				{
					userId: source.userId,
					username,
				},
				{
					notes: source.name ? `Saved from source: ${source.name}` : undefined,
					markdownData: content.markdownData,
					sourceEntryId: entry.id,
					sourceId: source.id,
					status: 'saved',
					tags: [`source: ${getSourceLabel(source)}`],
					textContent: content.textContent,
					title: entry.title,
					url: entry.url,
				},
				'source_sync',
				{
					appendTags: true,
					skipInboxForExisting: true,
				},
			);
		})
	);

	for (const result of results) {
		if (result.status === 'fulfilled') {
			savedCount += 1;
		} else {
			console.warn('Failed to ingest feed entry', result.reason);
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
				name: source.name,
				pollUrl: source.pollUrl,
				userId: source.userId,
			}).catch((error) => {
				console.warn('Source sync failed', error);
			})
		)
	);
}
