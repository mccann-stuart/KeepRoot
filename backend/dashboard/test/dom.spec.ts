import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDom } from '../src/lib/dom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardHtml = readFileSync(path.resolve(__dirname, '../../public/index.html'), 'utf8');
const bodyMarkup = dashboardHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? dashboardHtml;

describe('getDom', () => {
	beforeEach(() => {
		document.body.innerHTML = bodyMarkup;
	});

	it('returns dictionary of elements when all required elements are present in the DOM', () => {
		const dom = getDom();

		expect(dom.addListBtn.id).toBe('add-list-btn');
		expect(dom.addSmartListBtn.id).toBe('add-smart-list-btn');
		expect(dom.app.id).toBe('app');
		expect(dom.loginModal.id).toBe('login-modal');
		expect(dom.usernameInput.id).toBe('username-input');
		expect(dom.toast.id).toBe('toast');
		expect(dom.searchInput.id).toBe('search-input');
	});

	it('throws an error when all elements are missing from the DOM', () => {
		document.body.innerHTML = '';

		expect(() => getDom()).toThrow('Missing required element #add-list-btn');
	});

	it('throws an error when a specific required element is missing', () => {
		const button = document.getElementById('add-smart-list-btn');
		button?.remove();

		expect(() => getDom()).toThrow('Missing required element #add-smart-list-btn');
	});
});
