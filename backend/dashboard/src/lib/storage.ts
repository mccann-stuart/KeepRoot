import type { HighlightRecord, Preferences } from './state';

const STORAGE_KEYS = {
	font: 'keeproot_font',
	fontSize: 'keeproot_font_size',
	notifications: 'keeproot_notifications',
	theme: 'keeproot_theme',
	token: 'keeproot_secret',
};

const DEFAULT_PREFERENCES: Preferences = {
	font: 'default',
	fontSize: 16,
	notifications: true,
	theme: 'auto',
};

const HIGHLIGHT_STORAGE_PREFIX = 'keeproot_highlights_';

function getBrowserStorage(): Storage {
	return window.localStorage;
}

export function loadPreferences(): Preferences {
	const storage = getBrowserStorage();
	const theme = storage.getItem(STORAGE_KEYS.theme);
	const font = storage.getItem(STORAGE_KEYS.font);
	const fontSize = Number.parseFloat(storage.getItem(STORAGE_KEYS.fontSize) ?? '');

	return {
		font: font === 'sans' || font === 'dyslexic' ? font : DEFAULT_PREFERENCES.font,
		fontSize: Number.isFinite(fontSize) ? Math.min(32, Math.max(12, fontSize)) : DEFAULT_PREFERENCES.fontSize,
		notifications: localStorage.getItem(STORAGE_KEYS.notifications) !== 'false',
		theme: theme === 'light' || theme === 'dark' ? theme : DEFAULT_PREFERENCES.theme,
	};
}

export function clearDashboardDataPreservingSession(): void {
	const storage = getBrowserStorage();
	const keysToRemove: string[] = [];

	for (let index = 0; index < storage.length; index += 1) {
		const key = storage.key(index);
		if (!key || key === STORAGE_KEYS.token) {
			continue;
		}

		if (
			key === STORAGE_KEYS.theme
			|| key === STORAGE_KEYS.font
			|| key === STORAGE_KEYS.fontSize
			|| key === STORAGE_KEYS.notifications
			|| key.startsWith(HIGHLIGHT_STORAGE_PREFIX)
		) {
			keysToRemove.push(key);
		}
	}

	for (const key of keysToRemove) {
		storage.removeItem(key);
	}
}

export function savePreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
	const storage = getBrowserStorage();
	switch (key) {
		case 'font':
			storage.setItem(STORAGE_KEYS.font, value);
			return;
		case 'fontSize':
			storage.setItem(STORAGE_KEYS.fontSize, String(value));
			return;
		case 'notifications':
			storage.setItem(STORAGE_KEYS.notifications, String(value));
			return;
		case 'theme':
			storage.setItem(STORAGE_KEYS.theme, value);
			return;
	}
}

export function loadSessionToken(): string | null {
	return getBrowserStorage().getItem(STORAGE_KEYS.token);
}

export function saveSessionToken(token: string): void {
	getBrowserStorage().setItem(STORAGE_KEYS.token, token);
}

export function clearSessionToken(): void {
	getBrowserStorage().removeItem(STORAGE_KEYS.token);
}

function highlightStorageKey(bookmarkId: string): string {
	return `${HIGHLIGHT_STORAGE_PREFIX}${bookmarkId}`;
}

export function loadHighlights(bookmarkId: string): HighlightRecord[] {
	if (!bookmarkId) {
		return [];
	}

	try {
		const raw = getBrowserStorage().getItem(highlightStorageKey(bookmarkId));
		const parsed = JSON.parse(raw ?? '[]');
		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed.filter((highlight): highlight is HighlightRecord => (
			highlight
			&& typeof highlight.id === 'string'
			&& typeof highlight.note === 'string'
			&& typeof highlight.text === 'string'
		));
	} catch {
		return [];
	}
}

export function saveHighlights(bookmarkId: string, highlights: HighlightRecord[]): void {
	getBrowserStorage().setItem(highlightStorageKey(bookmarkId), JSON.stringify(highlights));
}
