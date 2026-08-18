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

	it('renders canonical YouTube media records with a restricted no-cookie iframe', () => {
		const fragment = renderMarkdown(
			'[Watch this video on YouTube](https://www.youtube-nocookie.com/embed/UdJHTPprjoI)',
		) as DocumentFragment;
		const iframe = fragment.querySelector('iframe');
		const externalLink = fragment.querySelector<HTMLAnchorElement>('.embedded-media__external-link');

		expect(iframe?.src).toBe('https://www.youtube-nocookie.com/embed/UdJHTPprjoI');
		expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation');
		expect(iframe?.referrerPolicy).toBe('no-referrer');
		expect(iframe?.allowFullscreen).toBe(true);
		expect(externalLink?.href).toBe('https://www.youtube.com/watch?v=UdJHTPprjoI');
		expect(externalLink?.rel).toBe('noopener noreferrer');
	});

	it('does not upgrade lookalike hosts, query-bearing records, or raw iframe HTML', () => {
		const fragment = renderMarkdown([
			'[Lookalike](https://www.youtube-nocookie.com.evil.test/embed/UdJHTPprjoI)',
			'',
			'[Query](https://www.youtube-nocookie.com/embed/UdJHTPprjoI?autoplay=1)',
			'',
			'<iframe src="https://www.youtube-nocookie.com/embed/UdJHTPprjoI"></iframe>',
		].join('\n')) as DocumentFragment;

		expect(fragment.querySelector('iframe')).toBeNull();
		expect(fragment.querySelectorAll('a')).toHaveLength(2);
	});
});
