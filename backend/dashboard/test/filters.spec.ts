import { describe, expect, it } from 'vitest';
import { collectTags, filterBookmarks } from '../src/lib/filters';
import type { BookmarkSummary, SmartListSummary } from '../src/lib/state';

const bookmarks: BookmarkSummary[] = [
	{
		id: 'bookmark-1',
		metadata: {
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
			isRead: true,
			listId: 'list-1',
			tags: ['ops'],
			title: 'Runbook',
			url: 'https://example.com/runbook',
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
});

describe('collectTags', () => {
	it('collects and sorts unique tags', () => {
		expect(collectTags(bookmarks)).toEqual(['ops', 'reading', 'work/project-a']);
	});
});
