import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncSource } from '../../src/ingest/source-sync';
import * as items from '../../src/storage/items';

describe('source-sync', () => {
	beforeEach(() => {
		vi.restoreAllMocks();

		vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation(() => {
			return {
				all: vi.fn().mockResolvedValue({ results: [] }),
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

		expect(result).toEqual(expect.objectContaining({ discoveredCount: 1, savedCount: 1 }));
		expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(items.saveItemContent).toHaveBeenCalledTimes(1);
	});

	it('treats a conditional 304 response as a successful no-work poll', async () => {
		const source = {
			httpEtag: '"feed-v2"',
			httpLastModified: 'Wed, 05 Aug 2026 22:00:00 GMT',
			id: 'source-conditional',
			kind: 'rss' as const,
			pollUrl: 'https://example.com/feed.xml',
			userId: 'user-1',
			validatorUrl: 'https://example.com/feed.xml',
		};
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
		vi.stubGlobal('fetch', fetchMock);

		const result = await syncSource(env as any, source);

		expect(result).toEqual(expect.objectContaining({
			discoveredCount: 0,
			notModified: true,
			recommendedIntervalMinutes: null,
			savedCount: 0,
		}));
		expect(items.saveItemContent).not.toHaveBeenCalled();
		const [, init] = fetchMock.mock.calls[0];
		expect(new Headers(init?.headers).get('If-None-Match')).toBe('"feed-v2"');
		expect(new Headers(init?.headers).get('If-Modified-Since')).toBe('Wed, 05 Aug 2026 22:00:00 GMT');
	});

	it('recommends one third of the observed publication gap', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`
			<rss><channel>
				<item><guid>one</guid><link>https://example.com/one</link><pubDate>2026-08-06T12:00:00Z</pubDate></item>
				<item><guid>two</guid><link>https://example.com/two</link><pubDate>2026-08-06T06:00:00Z</pubDate></item>
				<item><guid>three</guid><link>https://example.com/three</link><pubDate>2026-08-06T00:00:00Z</pubDate></item>
			</channel></rss>
		`, { status: 200 })));

		const result = await syncSource(env as any, {
			id: 'source-pattern',
			kind: 'rss',
			pollUrl: 'https://example.com/feed.xml',
			userId: 'user-1',
		});

		expect(result.recommendedIntervalMinutes).toBe(120);
	});

	it('skips unchanged feed entries before the item write path', async () => {
		vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((sql: string) => {
			if (sql.includes('source_entry_fingerprint')) {
				return {
					bind: vi.fn().mockReturnThis(),
					all: vi.fn().mockResolvedValue({
						results: [{
							source_entry_fingerprint: '144a7450303b1d2af132e89dda2d792e768272037b5c9ac6c2fcaf62becc11d0',
							source_entry_id: 'stable-entry',
						}],
					}),
				} as any;
			}
			return {
				bind: vi.fn().mockReturnThis(),
				first: vi.fn().mockResolvedValue({ username: 'testuser' }),
				run: vi.fn().mockResolvedValue({ success: true }),
			} as any;
		});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`
			<rss><channel><item>
				<guid>stable-entry</guid>
				<title>Stable item</title>
				<link>https://example.com/item1</link>
				<pubDate>2026-08-05T22:00:00Z</pubDate>
				<description>Stable body</description>
			</item></channel></rss>
		`, { status: 200 })));

		const result = await syncSource(env as any, {
			id: 'source-stable',
			kind: 'rss',
			pollUrl: 'https://example.com/feed.xml',
			userId: 'user-1',
		});

		expect(result).toEqual(expect.objectContaining({
			discoveredCount: 1,
			processedCount: 1,
			savedCount: 0,
			unchangedCount: 1,
		}));
		expect(items.saveItemContent).not.toHaveBeenCalled();
	});

	it('baselines migrated entries without rewriting their stored content', async () => {
		const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((sql: string) => {
			if (sql.includes('source_entry_fingerprint')) {
				return {
					bind: vi.fn().mockReturnThis(),
					all: vi.fn().mockResolvedValue({ results: [{ id: 'bookmark-1', published_at: null, source_entry_fingerprint: null, source_entry_id: 'legacy-entry' }] }),
				} as any;
			}
			return { bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue({ username: 'testuser' }), run: vi.fn() } as any;
		});
		const batch = vi.spyOn(env.KEEPROOT_DB, 'batch').mockResolvedValue([] as any);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
			'<rss><channel><item><guid>legacy-entry</guid><title>Legacy</title><link>https://example.com/legacy</link><pubDate>Thu, 06 Aug 2026 09:30:00 GMT</pubDate></item></channel></rss>',
			{ status: 200 },
		)));

		const result = await syncSource(env as any, { id: 'source-legacy', kind: 'rss', pollUrl: 'https://example.com/feed.xml', userId: 'user-1' });

		expect(result.unchangedCount).toBe(1);
		expect(items.saveItemContent).not.toHaveBeenCalled();
		expect(batch).toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]));
		expect(prepareSpy.mock.calls.some(([sql]) =>
			String(sql).includes('SET source_entry_fingerprint = ?')
			&& String(sql).includes('published_at = ?')
			&& String(sql).includes('source_id = ?')
		)).toBe(true);
	});

	it('rejects a feed body that exceeds the eight MiB processing limit', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat((8 * 1024 * 1024) + 1), {
			status: 200,
		})));

		await expect(syncSource(env as any, {
			id: 'source-oversized',
			kind: 'rss',
			pollUrl: 'https://example.com/feed.xml',
			userId: 'user-1',
		})).rejects.toThrow('exceeds the 8 MiB limit');
		expect(items.saveItemContent).not.toHaveBeenCalled();
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
						<guid isPermaLink="false">stratechery-post-1</guid>
						<pubDate>Thu, 06 Aug 2026 09:30:00 GMT</pubDate>
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

		expect(items.saveItemContent).toHaveBeenCalledTimes(1);
		const [, user, payload, reason, options] = vi.mocked(items.saveItemContent).mock.calls[0];
		expect(user).toEqual({ userId: 'user-1', username: 'testuser' });
		expect(payload).toEqual(
			expect.objectContaining({
				markdownData: expect.stringContaining('Second complete paragraph from the paid feed.'),
				publishedAt: '2026-08-06T09:30:00.000Z',
				sourceEntryId: 'stratechery-post-1',
				sourceEntryFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
				sourceId: 'source-full-content',
				tags: ['source: Stratechery'],
				textContent: expect.stringContaining('First complete paragraph from the paid feed.'),
			}),
		);
		expect(reason).toBe('source_sync');
		expect(options).toEqual({
			appendTags: true,
			skipInboxForExisting: true,
		});
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

		expect(result).toEqual(expect.objectContaining({ discoveredCount: 1, savedCount: 1 }));
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/redirect');
		expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/final-feed.xml');
	});

	it('does not forward validators to a redirected URL', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://feeds.example.net/final.xml' } }))
			.mockResolvedValueOnce(new Response('<rss><channel></channel></rss>', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		await syncSource(env as any, {
			httpEtag: '"private-validator"',
			id: 'source-redirect-validator',
			kind: 'rss',
			pollUrl: 'https://example.com/feed.xml',
			userId: 'user-1',
			validatorUrl: 'https://example.com/feed.xml',
		});

		expect(new Headers(fetchMock.mock.calls[0][1].headers).get('If-None-Match')).toBe('"private-validator"');
		expect(new Headers(fetchMock.mock.calls[1][1].headers).has('If-None-Match')).toBe(false);
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

	it('processes 200 changed entries and requests continuation without truncating discovery', async () => {
		const source = {
			id: 'source-5',
			kind: 'rss' as const,
			pollUrl: 'https://example.com/api/items',
			userId: 'user-1',
		};

		let xmlResponse = `<rss><channel>\n`;
		for (let i = 1; i <= 201; i++) {
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

		expect(result).toEqual(expect.objectContaining({
			discoveredCount: 201,
			needsContinuation: true,
			processedCount: 200,
			saturated: false,
			savedCount: 200,
		}));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(items.saveItemContent).toHaveBeenCalledTimes(200);
	});

	it('limits expensive entry writes to four concurrent operations', async () => {
		let xmlResponse = '<rss><channel>';
		for (let index = 1; index <= 8; index += 1) {
			xmlResponse += `<item><guid>entry-${index}</guid><title>Entry ${index}</title><link>https://example.com/${index}</link></item>`;
		}
		xmlResponse += '</channel></rss>';
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xmlResponse, { status: 200 })));
		let active = 0;
		let maximumActive = 0;
		vi.mocked(items.saveItemContent).mockImplementation(async () => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await new Promise((resolve) => setTimeout(resolve, 1));
			active -= 1;
			return {};
		});

		await syncSource(env as any, {
			id: 'source-concurrency',
			kind: 'rss',
			pollUrl: 'https://example.com/feed.xml',
			userId: 'user-1',
		});

		expect(maximumActive).toBe(4);
	});

	it('marks feeds above 2,000 visible entries as saturated', async () => {
		let xmlResponse = '<rss><channel>';
		for (let index = 1; index <= 2_001; index += 1) {
			xmlResponse += `<item><guid>visible-${index}</guid><title>Entry ${index}</title><link>https://example.com/${index}</link></item>`;
		}
		xmlResponse += '</channel></rss>';
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xmlResponse, { status: 200 })));

		const result = await syncSource(env as any, { id: 'source-saturated', kind: 'rss', pollUrl: 'https://example.com/feed.xml', userId: 'user-1' });

		expect(result).toEqual(expect.objectContaining({ discoveredCount: 2_001, needsContinuation: true, saturated: true, savedCount: 200 }));
	});

	it('records a failed entry without discarding successful writes', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
			'<rss><channel><item><guid>one</guid><link>https://example.com/one</link></item><item><guid>two</guid><link>https://example.com/two</link></item></channel></rss>',
			{ status: 200 },
		)));
		vi.mocked(items.saveItemContent)
			.mockResolvedValueOnce({} as any)
			.mockRejectedValueOnce(new Error('Permanent entry validation failure'));

		const result = await syncSource(env as any, { id: 'source-partial', kind: 'rss', pollUrl: 'https://example.com/feed.xml', userId: 'user-1' });

		expect(result).toEqual(expect.objectContaining({ errorCount: 1, savedCount: 1 }));
	});
});
