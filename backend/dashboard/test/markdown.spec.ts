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

	it('sanitizes again after applying highlight markup', () => {
		const html = renderMarkdown('Highlighted text here.', [
			{
				id: 'highlight-1" onclick="alert(1)',
				note: '" autofocus onfocus="alert(1)',
				text: 'Highlighted text',
			},
		]);
		const document = new DOMParser().parseFromString(html, 'text/html');
		const mark = document.querySelector('mark');

		expect(html).toContain('<mark');
		expect(html).toContain('Highlighted text');
		expect(mark?.hasAttribute('onclick')).toBe(false);
		expect(mark?.hasAttribute('autofocus')).toBe(false);
		expect(mark?.hasAttribute('onfocus')).toBe(false);
	});
});
