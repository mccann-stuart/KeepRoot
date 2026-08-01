import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncSource } from '../../src/ingest/source-sync';
import * as items from '../../src/storage/items';

describe('source-sync', () => {
	beforeEach(() => {
		vi.restoreAllMocks();

		vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation(() => {
			return {
				bind: vi.fn().mockReturnThis(),
				first: vi.fn().mockResolvedValue({ username: 'testuser' }),
				run: vi.fn().mockResolvedValue({ success: true }),
			} as any;
		});
		vi.spyOn(env.KEEPROOT_DB, 'batch').mockResolvedValue([] as any);

        // Mock saveItemContent to prevent triggering deeper storage/DB functions
        vi.spyOn(items, 'saveItemContent').mockResolvedValue('new-item-id');
	});

	it('throws error for unsafe initial source URL', async () => {
		const source = {
			id: 'source-1',
			kind: 'rss' as const,
			pollUrl: 'javascript:alert(1)',
			userId: 'user-1',
		};

		await expect(syncSource(env as any, source)).rejects.toThrow('Unsafe source URL');
	});

	it('fetches and parses feed entries successfully', async () => {
		const source = {
			id: 'source-2',
			kind: 'rss' as const,
			pollUrl: 'https://example.com/feed.xml',
			userId: 'user-1',
		};

		const xmlResponse = `
			<rss>
				<channel>
					<item>
						<title>Test Item 1</title>
						<link>https://example.com/item1</link>
						<description>Description 1</description>
					</item>
				</channel>
			</rss>
		`;

		const fetchMock = vi.fn().mockResolvedValue(new Response(xmlResponse, {
			status: 200,
			headers: { 'Content-Type': 'application/xml' }
		}));
		vi.stubGlobal('fetch', fetchMock);

		const result = await syncSource(env as any, source);

		expect(result).toEqual({ discoveredCount: 1, savedCount: 1 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(items.saveItemContent).toHaveBeenCalledTimes(1);
	});

	it('prefers full RSS content and adds an append-only source tag', async () => {
		const source = {
			id: 'source-full-content',
			kind: 'rss' as const,
			name: 'Stratechery',
			pollUrl: 'https://example.com/feed.xml',
			userId: 'user-1',
		};
		const xmlResponse = `
			<rss xmlns:content="http://purl.org/rss/1.0/modules/content/">
				<channel>
					<item>
						<title>Full Feed Article</title>
						<link>https://example.com/full-article</link>
						<description>Two-line teaser only.</description>
						<content:encoded><![CDATA[
							<h2>Full article heading</h2>
							<p>First complete paragraph from the paid feed.</p>
							<p>Second complete paragraph from the paid feed.</p>
						]]></content:encoded>
					</item>
				</channel>
			</rss>
		`;

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xmlResponse, { status: 200 })));

		await syncSource(env as any, source);

		expect(items.saveItemContent).toHaveBeenCalledWith(
			env,
			{ userId: 'user-1', username: 'testuser' },
			expect.objectContaining({
				markdownData: expect.stringContaining('Second complete paragraph from the paid feed.'),
				sourceId: 'source-full-content',
				tags: ['source: Stratechery'],
				textContent: expect.stringContaining('First complete paragraph from the paid feed.'),
			}),
			'source_sync',
			{ appendTags: true },
		);
		const payload = vi.mocked(items.saveItemContent).mock.calls[0][2];
		expect(payload.markdownData).not.toBe('Two-line teaser only.');
	});

	it('handles redirects correctly', async () => {
		const source = {
			id: 'source-3',
			kind: 'rss' as const,
			pollUrl: 'https://example.com/redirect',
			userId: 'user-1',
		};

		const xmlResponse = `
			<rss>
				<channel>
					<item>
						<title>Test Item</title>
						<link>https://example.com/item</link>
					</item>
				</channel>
			</rss>
		`;

		let callCount = 0;
		const fetchMock = vi.fn().mockImplementation(async (url: string) => {
			callCount++;
			if (callCount === 1) {
				return new Response(null, {
					status: 301,
					headers: { location: 'https://example.com/final-feed.xml' }
				});
			} else {
				return new Response(xmlResponse, { status: 200 });
			}
		});
		vi.stubGlobal('fetch', fetchMock);

		const result = await syncSource(env as any, source);

		expect(result).toEqual({ discoveredCount: 1, savedCount: 1 });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/redirect');
		expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/final-feed.xml');
	});

    it('throws error when max redirects is reached', async () => {
		const source = {
			id: 'source-4',
			kind: 'rss' as const,
			pollUrl: 'https://example.com/redirect',
			userId: 'user-1',
		};

		const fetchMock = vi.fn().mockImplementation(async (url: string) => {
			return new Response(null, {
				status: 301,
				headers: { location: 'https://example.com/redirect' }
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(syncSource(env as any, source)).rejects.toThrow('Failed to fetch source feed (301)');
        expect(fetchMock).toHaveBeenCalledTimes(5);
	});

	it('simulates a multi-page API response from a source (pagination logic test)', async () => {
		const source = {
			id: 'source-5',
			kind: 'rss' as const,
			pollUrl: 'https://example.com/api/items',
			userId: 'user-1',
		};

		// The current syncSource code doesn't parse <link rel="next"> or recursively fetch,
        // it just processes the initial feed and caps it to the first 25 entries.
		// 26 items to test the slice(0, 25) limit
		let xmlResponse = `<rss><channel>\n`;
		for (let i = 1; i <= 26; i++) {
			xmlResponse += `
				<item>
					<title>Test Item ${i}</title>
					<link>https://example.com/item${i}</link>
				</item>\n`;
		}
		xmlResponse += `</channel></rss>`;

		const fetchMock = vi.fn().mockResolvedValue(new Response(xmlResponse, {
			status: 200,
			headers: { 'Content-Type': 'application/xml' }
		}));
		vi.stubGlobal('fetch', fetchMock);

		const result = await syncSource(env as any, source);

		// It should discover all 26, but only save 25 due to slice(0, 25)
		expect(result).toEqual({ discoveredCount: 26, savedCount: 25 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(items.saveItemContent).toHaveBeenCalledTimes(25);
	});
});
