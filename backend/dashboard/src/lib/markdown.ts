import createDOMPurify from 'dompurify';
import { marked } from 'marked';
import type { HighlightRecord } from './state';

const DOMPurify = createDOMPurify(window);

marked.setOptions({
	breaks: true,
	gfm: true,
});

export function escapeHtml(value: string): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function encodeHtmlEntities(text: string): string {
	const element = document.createElement('div');
	element.textContent = text;
	return element.innerHTML;
}

function applyHighlights(html: string, highlights: HighlightRecord[]): string {
	return highlights.reduce((currentHtml, highlight) => {
		const escapedText = encodeHtmlEntities(highlight.text).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
		const highlightPattern = new RegExp(`(?![^<]*>)${escapedText}`, 'g');
		const noteClass = highlight.note ? ' has-note' : '';
		return currentHtml.replace(
			highlightPattern,
			`<mark class="highlight${noteClass}" data-id="${escapeHtml(highlight.id)}" title="${escapeHtml(highlight.note)}">${encodeHtmlEntities(highlight.text)}</mark>`,
		);
	}, html);
}

export function renderMarkdown(markdown: string, highlights: HighlightRecord[] = []): string {
	let html = marked.parse(markdown ?? '') as string;
	html = DOMPurify.sanitize(html);

	if (!highlights.length) {
		return html;
	}

	return DOMPurify.sanitize(applyHighlights(html, highlights));
}
