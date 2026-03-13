import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/lib/markdown';

describe('renderMarkdown', () => {
	it('renders markdown and injects highlights safely', () => {
		const html = renderMarkdown('## Heading\n\nHighlighted text here.', [
			{ id: 'highlight-1', note: 'Useful', text: 'Highlighted text' },
		]);

		expect(html).toContain('<h2>Heading</h2>');
		expect(html).toContain('class="highlight has-note"');
		expect(html).toContain('title="Useful"');
	});
});
