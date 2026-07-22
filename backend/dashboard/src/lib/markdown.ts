import createDOMPurify from 'dompurify';
import { marked } from 'marked';
import type { HighlightRecord } from './state';

let DOMPurify: ReturnType<typeof createDOMPurify> | undefined;

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
    if (typeof document === 'undefined') return escapeHtml(text);
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

export function renderMarkdown(markdown: string, highlights: HighlightRecord[] = []): string | Node {
    if (!DOMPurify && typeof window !== 'undefined') {
        DOMPurify = createDOMPurify(window);
    }
	let html = marked.parse(markdown ?? '') as string;

    if (typeof window !== 'undefined' && DOMPurify) {
	    html = DOMPurify.sanitize(html) as string;
    }

	if (!highlights.length) {
        if (typeof window !== 'undefined' && DOMPurify) {
		    return DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true });
        }
        return html;
	}

    if (typeof window !== 'undefined' && DOMPurify) {
	    return DOMPurify.sanitize(applyHighlights(html, highlights), { RETURN_DOM_FRAGMENT: true });
    }
    return applyHighlights(html, highlights);
}
