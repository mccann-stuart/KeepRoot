import { describe, it, expect } from 'vitest';
import { buildRootRelativeImageUrl } from '../../src/storage/bookmarks';

describe('buildRootRelativeImageUrl', () => {
	it('should return the root relative URL when origins match', () => {
		const result = buildRootRelativeImageUrl('https://example.com/path/image.png?q=1#hash', 'https://example.com/page');
		expect(result).toBe('/path/image.png?q=1#hash');
	});

	it('should return null when origins do not match', () => {
		const result = buildRootRelativeImageUrl('https://other.com/image.png', 'https://example.com/page');
		expect(result).toBeNull();
	});

	it('should return null when absoluteUrl is malformed', () => {
		const result = buildRootRelativeImageUrl('not-a-url', 'https://example.com/page');
		expect(result).toBeNull();
	});

	it('should return null when pageUrl is malformed', () => {
		const result = buildRootRelativeImageUrl('https://example.com/image.png', 'not-a-url');
		expect(result).toBeNull();
	});
});
