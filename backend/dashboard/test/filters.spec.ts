import { describe, expect, it } from 'vitest';
import { collectTags, filterBookmarks } from '../src/lib/filters';
import type { BookmarkSummary, SmartListSummary } from '../src/lib/state';

const bookmarks: BookmarkSummary[] = [
	{
		id: 'bookmark-1',
		metadata: {
			bodyText: 'Detailed notes about the quarterly strategy review.',
			excerpt: 'A reading item for the workstream.',
			isRead: false,
			listId: null,
			tags: ['work/project-a', 'reading'],
			title: 'Deep dive memo',
			url: 'https://example.com/memo',
		},
	},
	{
		id: 'bookmark-2',
		metadata: {
			bodyText: 'Production runbook for incident handling.',
			excerpt: 'Operational guide.',
			isRead: true,
			listId: 'list-1',
			tags: ['ops'],
			title: 'Runbook',
			url: 'https://example.com/runbook',
		},
	},
	{
		id: 'bookmark-3',
		metadata: {
			bodyText: 'This saved page covers Schengen rules and visa planning in detail.',
			excerpt: 'Travel research.',
			isRead: true,
			listId: null,
			tags: ['travel'],
			title: 'Visa planning checklist',
			url: 'https://example.com/travel',
		},
	},
];

const smartLists: SmartListSummary[] = [
	{ id: 'smart-1', name: 'Reading', rules: 'reading' },
];

describe('filterBookmarks', () => {
	it('filters inbox bookmarks', () => {
		const result = filterBookmarks({
			bookmarks,
			filterId: null,
			filterType: 'inbox',
			query: '',
			smartLists,
		});

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('bookmark-1');
	});

	it('filters by tag hierarchy and search query', () => {
		const result = filterBookmarks({
			bookmarks,
			filterId: 'work',
			filterType: 'tag',
			query: 'memo',
			smartLists,
		});

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('bookmark-1');
	});

	it('filters smart lists by comma-separated rules', () => {
		const result = filterBookmarks({
			bookmarks,
			filterId: 'smart-1',
			filterType: 'smartlist',
			query: '',
			smartLists,
		});

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('bookmark-1');
	});

	it('matches smart-list rules against bookmark titles', () => {
		const result = filterBookmarks({
			bookmarks,
			filterId: 'smart-2',
			filterType: 'smartlist',
			query: '',
			smartLists: [
				...smartLists,
				{ id: 'smart-2', name: 'Travel', rules: 'visa planning' },
			],
		});

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('bookmark-3');
	});

	it('matches smart-list rules against saved page content', () => {
		const result = filterBookmarks({
			bookmarks,
			filterId: 'smart-3',
			filterType: 'smartlist',
			query: '',
			smartLists: [
				...smartLists,
				{ id: 'smart-3', name: 'Schengen', rules: 'schengen rules' },
			],
		});

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('bookmark-3');
	});
});

describe('collectTags', () => {
	it('collects and sorts unique tags', () => {
		expect(collectTags(bookmarks)).toEqual(['ops', 'reading', 'travel', 'work/project-a']);
	});
});
