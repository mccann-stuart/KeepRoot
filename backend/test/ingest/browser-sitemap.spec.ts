import { describe, expect, it, vi } from 'vitest';
import {
	discoverBrowserSitemap,
	shortlistBrowserSitemapEntries,
	type BrowserSitemapEntry,
} from '../../src/ingest/browser-sitemap';

describe('Browser source sitemap discovery', () => {
	it('follows declared same-origin sitemap indexes and rejects cross-origin URLs', async () => {
		const fetchImpl = vi.fn<typeof fetch>(async (input) => {
			const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
			if (url.pathname === '/robots.txt') {
				return new Response('Sitemap: https://example.com/sitemap-index.xml');
			}
			if (url.pathname === '/sitemap-index.xml') {
				return new Response(`<?xml version="1.0"?>
					<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
						<sitemap><loc>https://example.com/posts.xml</loc></sitemap>
						<sitemap><loc>https://other.example/private.xml</loc></sitemap>
					</sitemapindex>`);
			}
			if (url.pathname === '/posts.xml') {
				return new Response(`<?xml version="1.0"?>
					<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
						<url><loc>https://example.com/posts/new</loc><lastmod>2026-08-13</lastmod></url>
						<url><loc>https://other.example/posts/rejected</loc><lastmod>2026-08-12</lastmod></url>
					</urlset>`);
			}
			return new Response('Not found', { status: 404 });
		});

		await expect(discoverBrowserSitemap('https://example.com/blog', fetchImpl)).resolves.toEqual({
			entries: [{
				lastModifiedAt: '2026-08-13T00:00:00.000Z',
				url: 'https://example.com/posts/new',
			}],
			found: true,
		});
		expect(fetchImpl).not.toHaveBeenCalledWith(
			'https://other.example/private.xml',
			expect.anything(),
		);
	});

	it('ranks article-like leaves by last modification date as a candidate hint', () => {
		const entries: BrowserSitemapEntry[] = [
			{ lastModifiedAt: '2026-08-13', url: 'https://example.com/' },
			{ lastModifiedAt: '2026-08-15', url: 'https://example.com/analysis' },
			{ lastModifiedAt: '2026-08-13', url: 'https://example.com/essays' },
			{ lastModifiedAt: '2026-08-11', url: 'https://example.com/essays/older' },
			{ lastModifiedAt: '2026-08-13', url: 'https://example.com/essays/newer' },
			{ lastModifiedAt: '2026-08-12', url: 'https://example.com/essays/middle' },
			{ lastModifiedAt: '2026-08-14', url: 'https://example.com/category/news' },
			{ lastModifiedAt: '2026-08-14', url: 'https://example.com/essays/report.pdf' },
			{ lastModifiedAt: '2026-08-14', url: 'https://example.com/essays/newer?preview=1' },
		];

		expect(shortlistBrowserSitemapEntries('https://example.com/essays/newer', entries).map((entry) => entry.url)).toEqual([
			'https://example.com/essays/newer',
			'https://example.com/essays/middle',
			'https://example.com/essays/older',
		]);
		expect(shortlistBrowserSitemapEntries('https://example.com/analysis', entries).map((entry) => entry.url)).not.toContain(
		'https://example.com/analysis',
	);
	});
});
