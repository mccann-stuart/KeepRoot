import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/lib/markdown';

describe('renderMarkdown', () => {
	it('renders markdown and injects highlights safely', () => {
		const fragment = renderMarkdown('## Heading\n\nHighlighted text here.', [
			{ id: 'highlight-1', note: 'Useful', text: 'Highlighted text' },
		]);
        const tempDiv = document.createElement('div');
        tempDiv.appendChild(fragment as DocumentFragment);
        const html = tempDiv.innerHTML;

		expect(html).toContain('<h2>Heading</h2>');
		expect(html).toContain('class="highlight has-note"');
		expect(html).toContain('title="Useful"');
	});

	it('sanitizes again after applying highlight markup', () => {
		const fragment = renderMarkdown('Highlighted text here.', [
			{
				id: 'highlight-1" onclick="alert(1)',
				note: '" autofocus onfocus="alert(1)',
				text: 'Highlighted text',
			},
		]);
        const tempDiv = document.createElement('div');
        tempDiv.appendChild(fragment as DocumentFragment);
        const html = tempDiv.innerHTML;
		const mark = tempDiv.querySelector('mark');

		expect(html).toContain('<mark');
		expect(html).toContain('Highlighted text');
		expect(mark?.hasAttribute('onclick')).toBe(false);
		expect(mark?.hasAttribute('autofocus')).toBe(false);
		expect(mark?.hasAttribute('onfocus')).toBe(false);
	});
});
