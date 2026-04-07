import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardHtml = readFileSync(path.resolve(__dirname, '../../public/index.html'), 'utf8');
const bodyMarkup = dashboardHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? dashboardHtml;

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

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: {
			'Content-Type': 'application/json',
		},
		status,
	});
}

async function flush(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

async function bootDashboard(options?: {
	account?: Record<string, unknown>;
	apiKeys?: Array<Record<string, unknown>>;
	handleFetch?: (url: string, method: string, init?: RequestInit) => Response | Promise<Response> | undefined;
	sources?: Array<Record<string, unknown>>;
	stats?: Record<string, unknown>;
}): Promise<{ fetchSpy: ReturnType<typeof vi.fn> }> {
	vi.resetModules();
	document.body.innerHTML = bodyMarkup;
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		value: createStorageMock(),
	});
	window.localStorage.setItem('keeproot_secret', 'session-secret');
	window.history.replaceState({}, '', '/dashboard');

	Object.defineProperty(window, 'matchMedia', {
		configurable: true,
		value: vi.fn().mockReturnValue({
			addEventListener: vi.fn(),
			matches: false,
			removeEventListener: vi.fn(),
		}),
	});
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: {
			...navigator,
			clipboard: {
				writeText: vi.fn().mockResolvedValue(undefined),
			},
			serviceWorker: {
				register: vi.fn().mockResolvedValue(undefined),
			},
		},
	});
	Object.defineProperty(window, 'confirm', {
		configurable: true,
		value: vi.fn().mockReturnValue(true),
	});
	Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
		configurable: true,
		value() {},
	});
	Object.defineProperty(HTMLDialogElement.prototype, 'close', {
		configurable: true,
		value() {},
	});

	const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		const method = init?.method ?? 'GET';
		const customResponse = await options?.handleFetch?.(url, method, init);
		if (customResponse) {
			return customResponse;
		}

		if (url.endsWith('/bookmarks') && method === 'GET') {
			return jsonResponse({ keys: [] });
		}

		if (url.endsWith('/lists') && method === 'GET') {
			return jsonResponse({ lists: [] });
		}

		if (url.endsWith('/smart-lists') && method === 'GET') {
			return jsonResponse({ lists: [] });
		}

		if (url.endsWith('/account') && method === 'GET') {
			return jsonResponse(options?.account ?? {
				account: {
					displayName: 'Test User',
					plan: 'self_hosted',
					userId: 'user-1',
					username: 'tester',
				},
				features: {
					email: true,
					rss: true,
					x: true,
					youtube: true,
				},
				limits: {},
				tokenType: 'api_key',
			});
		}

		if (url.endsWith('/stats') && method === 'GET') {
			return jsonResponse(options?.stats ?? {
				inbox: { pending: 2 },
				items: { byStatus: { unread: 2 }, total: 2 },
				recentToolUsage: [{ count: 3, status: 'success', toolName: 'list_items' }],
				sourceHealth: [{ id: 'source-1', kind: 'rss', lastSuccessAt: '2026-03-16T10:00:00.000Z', name: 'Root Feed', status: 'active' }],
				sources: { byKind: { rss: 1 }, total: 1 },
			});
		}

		if (url.endsWith('/sources') && method === 'GET') {
			return jsonResponse({
				nextCursor: null,
				sources: options?.sources ?? [{
					emailAlias: 'save+abc@mail.keeproot.test',
					id: 'source-1',
					kind: 'email',
					name: 'Digest Inbox',
					normalizedIdentifier: 'weekly-digest',
					status: 'active',
				}],
			});
		}

		if (url.endsWith('/api-keys') && method === 'GET') {
			return jsonResponse({ keys: options?.apiKeys ?? [] });
		}

		throw new Error(`Unhandled fetch: ${method} ${url}`);
	});

	vi.stubGlobal('fetch', fetchSpy);

	await import('../src/main');
	await flush();
	await flush();
	return { fetchSpy };
}

describe('dashboard MCP setup view', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('renders the MCP setup view with origin-derived preset values', async () => {
		await bootDashboard();

		const navMcp = document.getElementById('nav-mcp') as HTMLButtonElement;
		navMcp.click();
		await flush();
		await flush();
		const expectedEndpoint = `${window.location.origin}/mcp`;

		expect((document.getElementById('current-view-title') as HTMLElement).textContent).toBe('MCP Setup');
		expect(navMcp.classList.contains('nav-link--active')).toBe(true);
		expect((document.getElementById('mcp-view') as HTMLElement).classList.contains('is-hidden')).toBe(false);
		expect((document.getElementById('mcp-endpoint-value') as HTMLInputElement).value).toBe(expectedEndpoint);

		const claudeValue = (document.getElementById('mcp-preset-claude-value') as HTMLTextAreaElement).value;
		const openAiValue = (document.getElementById('mcp-preset-openai-value') as HTMLTextAreaElement).value;
		expect(claudeValue).toContain(`claude mcp add --transport http keeproot ${expectedEndpoint}`);
		expect(claudeValue).toContain('<API_KEY>');
		expect(openAiValue).toContain(`"server_url": "${expectedEndpoint}"`);
		expect(openAiValue).toContain('"require_approval": "always"');
		expect(openAiValue).toContain('<API_KEY>');
		expect(openAiValue).not.toContain('session-secret');

		(document.getElementById('open-api-keys-from-mcp-btn') as HTMLButtonElement).click();
		await flush();
		expect((document.getElementById('current-view-title') as HTMLElement).textContent).toBe('API Keys');
	});

	it('disables unsupported source kinds and updates bridge-url UI for X sources', async () => {
		await bootDashboard({
			account: {
				account: {
					displayName: 'Test User',
					plan: 'self_hosted',
					userId: 'user-1',
					username: 'tester',
				},
				features: {
					email: false,
					rss: true,
					x: true,
					youtube: true,
				},
				limits: {},
				tokenType: 'api_key',
			},
			sources: [{
				id: 'source-1',
				kind: 'rss',
				lastSuccessAt: '2026-03-16T10:00:00.000Z',
				name: 'Root Feed',
				normalizedIdentifier: 'https://feeds.example.com/root.xml',
				status: 'active',
			}],
		});

		(document.getElementById('nav-mcp') as HTMLButtonElement).click();
		await flush();
		await flush();

		const sourceKind = document.getElementById('mcp-source-kind') as HTMLSelectElement;
		const emailOption = [...sourceKind.options].find((option) => option.value === 'email');
		const xOption = [...sourceKind.options].find((option) => option.value === 'x');
		expect(emailOption?.disabled).toBe(true);
		expect(xOption?.disabled).toBe(false);

		sourceKind.value = 'x';
		sourceKind.dispatchEvent(new Event('change', { bubbles: true }));

		expect((document.getElementById('mcp-source-identifier-label') as HTMLElement).textContent).toBe('Profile Identifier');
		expect((document.getElementById('mcp-source-bridge-field') as HTMLElement).classList.contains('is-hidden')).toBe(false);
		expect((document.getElementById('mcp-sources-list') as HTMLElement).textContent).toContain('Root Feed');
		expect((document.getElementById('mcp-sources-list') as HTMLElement).textContent).toContain('Remove');
	});

	it('clears all data from settings after confirmation and preserves the session token', async () => {
		let cleared = false;
		await bootDashboard({
			apiKeys: [{
				createdAt: '2026-03-16T10:00:00.000Z',
				id: 'key-1',
				name: 'Primary Key',
			}],
			handleFetch: (url, method) => {
				if (url.endsWith('/account/data') && method === 'DELETE') {
					cleared = true;
					return jsonResponse({ message: 'All data cleared' });
				}
				if (cleared && url.endsWith('/api-keys') && method === 'GET') {
					return jsonResponse({ keys: [] });
				}
				if (cleared && url.endsWith('/bookmarks') && method === 'GET') {
					return jsonResponse({ keys: [] });
				}
				if (cleared && url.endsWith('/lists') && method === 'GET') {
					return jsonResponse({ lists: [] });
				}
				if (cleared && url.endsWith('/smart-lists') && method === 'GET') {
					return jsonResponse({ lists: [] });
				}
				if (cleared && url.endsWith('/stats') && method === 'GET') {
					return jsonResponse({
						inbox: { pending: 0 },
						items: { byStatus: {}, total: 0 },
						recentToolUsage: [],
						sourceHealth: [],
						sources: { byKind: {}, total: 0 },
					});
				}
				if (cleared && url.endsWith('/sources') && method === 'GET') {
					return jsonResponse({ nextCursor: null, sources: [] });
				}
				return undefined;
			},
		});

		window.localStorage.setItem('keeproot_theme', 'dark');
		window.localStorage.setItem('keeproot_font', 'sans');
		window.localStorage.setItem('keeproot_font_size', '22');
		window.localStorage.setItem('keeproot_notifications', 'false');
		window.localStorage.setItem('keeproot_highlights_bookmark-1', JSON.stringify([{ id: 'h1', note: 'note', text: 'text' }]));

		(document.getElementById('open-settings-btn') as HTMLButtonElement).click();
		await flush();

		(document.getElementById('clear-data-btn') as HTMLButtonElement).click();
		await flush();
		await flush();

		expect(fetch).toHaveBeenCalledWith('/account/data', expect.objectContaining({
			headers: expect.any(Headers),
			method: 'DELETE',
		}));
		expect(window.localStorage.getItem('keeproot_secret')).toBe('session-secret');
		expect(window.localStorage.getItem('keeproot_theme')).toBe('auto');
		expect(window.localStorage.getItem('keeproot_font')).toBe('default');
		expect(window.localStorage.getItem('keeproot_font_size')).toBe('16');
		expect(window.localStorage.getItem('keeproot_notifications')).toBe('true');
		expect(window.localStorage.getItem('keeproot_highlights_bookmark-1')).toBeNull();
		expect((document.getElementById('api-keys-list') as HTMLElement).textContent).toContain('No active API keys.');
		expect((document.getElementById('current-view-title') as HTMLElement).textContent).toBe('Settings');
	});

	it('does nothing when clear all data confirmation is cancelled', async () => {
		await bootDashboard();
		vi.mocked(window.confirm).mockReturnValue(false);

		(document.getElementById('open-settings-btn') as HTMLButtonElement).click();
		await flush();

		(document.getElementById('clear-data-btn') as HTMLButtonElement).click();
		await flush();

		expect(fetch).not.toHaveBeenCalledWith('/account/data', expect.anything());
		expect(window.localStorage.getItem('keeproot_secret')).toBe('session-secret');
	});

	it('marks an unread bookmark as read after opening it in the reader', async () => {
		let bookmarkIsRead = false;

		const { fetchSpy } = await bootDashboard({
			handleFetch: (url, method, init) => {
				if (url.endsWith('/bookmarks') && method === 'GET') {
					return jsonResponse({
						keys: [{
							id: 'bookmark-1',
							metadata: {
								createdAt: '2026-03-16T10:00:00.000Z',
								isRead: bookmarkIsRead,
								title: 'Unread article',
								url: 'https://example.com/articles/unread',
								wordCount: 400,
							},
						}],
					});
				}

				if (url.endsWith('/bookmarks/bookmark-1') && method === 'GET') {
					return jsonResponse({
						id: 'bookmark-1',
						markdownData: '# Unread article',
						metadata: {
							createdAt: '2026-03-16T10:00:00.000Z',
							isRead: bookmarkIsRead,
							title: 'Unread article',
							url: 'https://example.com/articles/unread',
							wordCount: 400,
						},
					});
				}

				if (url.endsWith('/bookmarks/bookmark-1') && method === 'PATCH') {
					expect(init?.body).toBe(JSON.stringify({ isRead: true }));
					bookmarkIsRead = true;
					return jsonResponse({ message: 'Updated successfully' });
				}

				return undefined;
			},
		});

		const bookmarkCard = document.querySelector('.bookmark-card') as HTMLElement | null;
		expect(bookmarkCard).not.toBeNull();

		bookmarkCard?.click();
		await flush();
		await flush();
		await flush();

		expect(fetchSpy).toHaveBeenCalledWith('/bookmarks/bookmark-1', expect.objectContaining({
			headers: expect.any(Headers),
			method: 'PATCH',
		}));
		expect((document.getElementById('current-view-title') as HTMLElement).textContent).toBe('Reader');
	});
});
