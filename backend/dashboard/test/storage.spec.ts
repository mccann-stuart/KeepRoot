import { beforeEach, describe, expect, it } from 'vitest';
import { clearSessionToken, loadHighlights, loadPreferences, loadSessionToken, saveHighlights, savePreference, saveSessionToken } from '../src/lib/storage';

function createStorageMock(): Storage {
	const store = new Map<string, string>();
	return {
		clear() {
			store.clear();
		},
		getItem(key: string) {
			return store.has(key) ? store.get(key)! : null;
		},
		key(index: number) {
			return [...store.keys()][index] ?? null;
		},
		get length() {
			return store.size;
		},
		removeItem(key: string) {
			store.delete(key);
		},
		setItem(key: string, value: string) {
			store.set(key, value);
		},
	};
}

describe('dashboard storage helpers', () => {
	beforeEach(() => {
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			value: createStorageMock(),
		});
	});

	it('loads defaults and persists preferences', () => {
		expect(loadPreferences()).toMatchObject({
			font: 'default',
			fontSize: 16,
			notifications: true,
			theme: 'auto',
		});

		savePreference('theme', 'dark');
		savePreference('font', 'sans');
		savePreference('fontSize', 20);
		savePreference('notifications', false);

		expect(loadPreferences()).toMatchObject({
			font: 'sans',
			fontSize: 20,
			notifications: false,
			theme: 'dark',
		});
	});

	it('persists sessions and highlight notes', () => {
		saveSessionToken('secret');
		expect(loadSessionToken()).toBe('secret');

		saveHighlights('bookmark-1', [
			{ id: 'highlight-1', note: 'Important', text: 'Quoted text' },
		]);
		expect(loadHighlights('bookmark-1')).toEqual([
			{ id: 'highlight-1', note: 'Important', text: 'Quoted text' },
		]);

		clearSessionToken();
		expect(loadSessionToken()).toBeNull();
	});
});
