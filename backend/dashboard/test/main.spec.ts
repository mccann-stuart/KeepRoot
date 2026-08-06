import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@simplewebauthn/browser', () => ({
	startAuthentication: vi.fn().mockResolvedValue({ id: 'credential-1' }),
	startRegistration: vi.fn().mockResolvedValue({ id: 'credential-1' }),
}));

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
	beforeImport?: () => void;
	cookieSession?: boolean;
	handleFetch?: (url: string, method: string, init?: RequestInit) => Response | Promise<Response> | undefined;
	initialUrl?: string;
	rememberedUsername?: string;
	sessionToken?: string | null;
	sources?: Array<Record<string, unknown>>;
	stats?: Record<string, unknown>;
}): Promise<{ fetchSpy: ReturnType<typeof vi.fn> }> {
	vi.resetModules();
	document.body.innerHTML = bodyMarkup;
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		value: createStorageMock(),
	});
	Object.defineProperty(window, 'sessionStorage', {
		configurable: true,
		value: createStorageMock(),
	});
	const sessionToken = options?.sessionToken === undefined ? 'session-secret' : options.sessionToken;
	if (sessionToken) {
		window.sessionStorage.setItem('keeproot_secret', sessionToken);
	}
	if (options?.rememberedUsername) {
		window.localStorage.setItem('keeproot_remembered_username', options.rememberedUsername);
	}
	window.history.replaceState({}, '', options?.initialUrl ?? '/dashboard');

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

		if (url.endsWith('/auth/context') && method === 'GET') {
			return jsonResponse({
				authenticationOrigin: window.location.origin,
				requiresHandoff: false,
			});
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
			if (!window.sessionStorage.getItem('keeproot_secret') && !options?.cookieSession) {
				return jsonResponse({ error: 'Unauthorized' }, 401);
			}
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
				ingestion: {
					dailyRefreshes: 12,
					dlq: { backlog: 0, oldestJobAgeSeconds: 0 },
					failedSources: 0,
					health: 'green',
					interpretation: 'Feeds are current and processing normally.',
					processingErrors: 0,
					queue: { backlog: 3, oldestJobAgeSeconds: 42 },
					saturatedSources: 0,
				},
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

	options?.beforeImport?.();
	await import('../src/main');
	await flush();
	await flush();
	return { fetchSpy };
}

describe('dashboard extension downloads', () => {
	beforeEach(() => {
		document.body.innerHTML = bodyMarkup;
	});

	it('links to the Chrome and Safari bundles served by the Worker', () => {
		const chromeDownload = document.getElementById('download-chrome-extension') as HTMLAnchorElement;
		const safariDownload = document.getElementById('download-safari-extension') as HTMLAnchorElement;

		expect(chromeDownload.getAttribute('href')).toBe('/downloads/keeproot-chrome.zip');
		expect(chromeDownload.getAttribute('download')).toBe('keeproot-chrome.zip');
		expect(safariDownload.getAttribute('href')).toBe('/downloads/keeproot-safari.zip');
		expect(safariDownload.getAttribute('download')).toBe('keeproot-safari.zip');
	});
});

describe('dashboard login', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('prefills a remembered username and keeps the option selected', async () => {
		await bootDashboard({
			rememberedUsername: 'alice',
			sessionToken: null,
		});

		expect((document.getElementById('username-input') as HTMLInputElement).value).toBe('alice');
		expect((document.getElementById('remember-username-input') as HTMLInputElement).checked).toBe(true);
	});

	it('restores a seven-day cookie session after browser session storage is lost', async () => {
		const { fetchSpy } = await bootDashboard({
			cookieSession: true,
			sessionToken: null,
		});

		expect(document.getElementById('app')?.classList.contains('is-hidden')).toBe(false);
		const accountCall = fetchSpy.mock.calls.find(([input]) => String(input).endsWith('/account'));
		expect(accountCall).toBeDefined();
		expect((accountCall?.[1]?.headers as Headers).get('Authorization')).toBeNull();
		expect(accountCall?.[1]?.credentials).toBe('same-origin');
	});

	it('restores a preview session from the URL fragment before loading the account', async () => {
		const { fetchSpy } = await bootDashboard({
			initialUrl: '/#preview_session=preview-session-token',
			sessionToken: null,
		});

		expect(window.sessionStorage.getItem('keeproot_secret')).toBe('preview-session-token');
		expect(window.location.hash).toBe('');
		const bookmarkCall = fetchSpy.mock.calls.find(([input]) => String(input).endsWith('/bookmarks'));
		expect((bookmarkCall?.[1]?.headers as Headers).get('Authorization')).toBe('Bearer preview-session-token');
	});

	it('sends preview login to the stable authentication origin before starting WebAuthn', async () => {
		const authenticationOrigin = 'https://keeproot.example.workers.dev';
		const { fetchSpy } = await bootDashboard({
			handleFetch: (url, method) => {
				if (url.endsWith('/auth/context') && method === 'GET') {
					return jsonResponse({
						authenticationOrigin,
						requiresHandoff: true,
					});
				}
				return undefined;
			},
			sessionToken: null,
		});
		let navigatedTo = '';
		const captureNavigation = (event: Event) => {
			const anchor = (event.target as Element).closest<HTMLAnchorElement>('a');
			if (!anchor || !anchor.href.startsWith(authenticationOrigin)) {
				return;
			}
			event.preventDefault();
			navigatedTo = anchor.href;
		};
		document.addEventListener('click', captureNavigation, true);
		expect(fetchSpy.mock.calls.some(([input]) => String(input).endsWith('/auth/context'))).toBe(true);

		(document.getElementById('username-input') as HTMLInputElement).value = 'alice';
		(document.getElementById('btn-login') as HTMLButtonElement).click();
		await flush();
		document.removeEventListener('click', captureNavigation, true);

		expect(document.getElementById('auth-status')?.textContent).toBe('');
		expect(navigatedTo).toBe(`${authenticationOrigin}/?preview_return=${encodeURIComponent(window.location.origin)}`);
		expect(fetchSpy.mock.calls.some(([input]) => String(input).endsWith('/auth/generate-authentication'))).toBe(false);
	});

	it('exchanges an existing canonical session for the requested preview session', async () => {
		const previewOrigin = 'https://feature-keeproot.example.workers.dev';
		let navigatedTo = '';
		const captureNavigation = (event: Event) => {
			const anchor = (event.target as Element).closest<HTMLAnchorElement>('a');
			if (!anchor || !anchor.href.includes('/auth/preview-session')) {
				return;
			}
			event.preventDefault();
			navigatedTo = anchor.href;
		};
		await bootDashboard({
			beforeImport: () => document.addEventListener('click', captureNavigation, true),
			cookieSession: true,
			initialUrl: `/?preview_return=${encodeURIComponent(previewOrigin)}`,
			sessionToken: null,
		});
		document.removeEventListener('click', captureNavigation, true);

		expect(navigatedTo).toBe(`${window.location.origin}/auth/preview-session?return_to=${encodeURIComponent(previewOrigin)}`);
	});

	it('remembers the trimmed username after a successful login', async () => {
		await bootDashboard({
			handleFetch: (url, method) => {
				if (url.endsWith('/auth/generate-authentication') && method === 'POST') {
					return jsonResponse({ challenge: 'challenge-1' });
				}
				if (url.endsWith('/auth/verify-authentication') && method === 'POST') {
					return jsonResponse({ token: 'new-session', verified: true });
				}
				return undefined;
			},
			sessionToken: null,
		});

		const usernameInput = document.getElementById('username-input') as HTMLInputElement;
		const rememberUsernameInput = document.getElementById('remember-username-input') as HTMLInputElement;
		usernameInput.value = '  alice  ';
		rememberUsernameInput.checked = true;
		(document.getElementById('passkey-form') as HTMLFormElement).requestSubmit();
		await flush();
		await flush();

		expect(window.localStorage.getItem('keeproot_remembered_username')).toBe('alice');
		expect(window.sessionStorage.getItem('keeproot_secret')).toBe('new-session');
		expect(window.localStorage.getItem('keeproot_secret')).toBeNull();
	});

	it('shows authentication failures inside the open login dialog', async () => {
		await bootDashboard({
			handleFetch: (url, method) => {
				if (url.endsWith('/auth/generate-authentication') && method === 'POST') {
					return jsonResponse({ challenge: 'challenge-1' });
				}
				if (url.endsWith('/auth/verify-authentication') && method === 'POST') {
					return jsonResponse({ error: 'Authentication failed' }, 400);
				}
				return undefined;
			},
			sessionToken: null,
		});

		(document.getElementById('username-input') as HTMLInputElement).value = 'alice';
		(document.getElementById('passkey-form') as HTMLFormElement).requestSubmit();
		await flush();
		await flush();

		const authStatus = document.getElementById('auth-status') as HTMLParagraphElement;
		expect(authStatus.textContent).toBe('Authentication failed');
		expect(authStatus.classList.contains('is-hidden')).toBe(false);
	});

	it('prevents registration from interrupting an active login ceremony', async () => {
		let resolveAuthenticationOptions!: (response: Response) => void;
		const authenticationOptions = new Promise<Response>((resolve) => {
			resolveAuthenticationOptions = resolve;
		});
		const { fetchSpy } = await bootDashboard({
			handleFetch: (url, method) => {
				if (url.endsWith('/auth/generate-authentication') && method === 'POST') {
					return authenticationOptions;
				}
				if (url.endsWith('/auth/verify-authentication') && method === 'POST') {
					return jsonResponse({ token: 'new-session', verified: true });
				}
				return undefined;
			},
			sessionToken: null,
		});

		(document.getElementById('username-input') as HTMLInputElement).value = 'alice';
		(document.getElementById('passkey-form') as HTMLFormElement).requestSubmit();
		await flush();

		const loginButton = document.getElementById('btn-login') as HTMLButtonElement;
		const registerButton = document.getElementById('btn-register') as HTMLButtonElement;
		expect(loginButton.disabled).toBe(true);
		expect(registerButton.disabled).toBe(true);

		registerButton.click();
		await flush();
		expect(fetchSpy.mock.calls.some(([input]) => String(input).endsWith('/auth/generate-registration'))).toBe(false);

		resolveAuthenticationOptions(jsonResponse({ challenge: 'challenge-1' }));
		await flush();
		await flush();
		expect(loginButton.disabled).toBe(false);
		expect(registerButton.disabled).toBe(false);
	});

	it('revokes the current session before clearing local login state', async () => {
		await bootDashboard({
			handleFetch: (url, method) => {
				if (url.endsWith('/auth/logout') && method === 'POST') {
					return jsonResponse({ message: 'Logged out' });
				}
				return undefined;
			},
		});

		(document.getElementById('logout-btn') as HTMLButtonElement).click();
		await flush();
		await flush();

		expect(fetch).toHaveBeenCalledWith('/auth/logout', expect.objectContaining({
			headers: expect.any(Headers),
			method: 'POST',
		}));
		expect(window.sessionStorage.getItem('keeproot_secret')).toBeNull();
	});
});

describe('dashboard keyboard shortcuts', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('focuses library search when slash is pressed', async () => {
		await bootDashboard();

		const searchInput = document.getElementById('search-input') as HTMLInputElement;
		const shortcut = new KeyboardEvent('keydown', {
			bubbles: true,
			cancelable: true,
			key: '/',
		});
		document.body.dispatchEvent(shortcut);

		expect(shortcut.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(searchInput);
	});

	it('leaves slash available while editing text', async () => {
		await bootDashboard();

		const noteInput = document.getElementById('note-input') as HTMLTextAreaElement;
		noteInput.focus();
		const slash = new KeyboardEvent('keydown', {
			bubbles: true,
			cancelable: true,
			key: '/',
		});
		noteInput.dispatchEvent(slash);

		expect(slash.defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(noteInput);
	});
});

describe('dashboard MCP setup view', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('opens source management from the first Connections navigation item', async () => {
		await bootDashboard();

		const connections = document.querySelector<HTMLElement>('.sidebar-group--connections');
		const connectionLabels = [...(connections?.querySelectorAll<HTMLButtonElement>('.nav-link') ?? [])]
			.map((button) => button.textContent?.trim());
		const navSources = document.getElementById('nav-sources') as HTMLButtonElement;
		navSources.click();
		await flush();
		await flush();

		expect(connectionLabels).toEqual(['Sources', 'API keys', 'MCP setup']);
		expect((document.getElementById('current-view-title') as HTMLElement).textContent).toBe('Sources');
		expect(navSources.classList.contains('nav-link--active')).toBe(true);
		expect((document.getElementById('sources-view') as HTMLElement).classList.contains('is-hidden')).toBe(false);
		expect(document.querySelector('#sources-view #mcp-source-form')).not.toBeNull();
		expect(document.querySelector('#sources-view #mcp-sources-list')).not.toBeNull();
		const sourceHealthList = document.querySelector<HTMLElement>('#sources-view #mcp-source-health-list');
		expect(sourceHealthList).not.toBeNull();
		expect(sourceHealthList?.textContent ?? '').toContain('Feeds are current and processing normally.');
		expect(sourceHealthList?.textContent ?? '').toContain('Queue 3 · Oldest 42s · DLQ 0');
		expect(document.querySelector('#mcp-view #mcp-source-form')).toBeNull();
		expect(document.querySelector('#mcp-view #mcp-sources-list')).toBeNull();
		expect(document.querySelector('#mcp-view #mcp-source-health-list')).toBeNull();
	});

	it('queues a manual refresh from a pollable Source Health row', async () => {
		let resolveRefresh!: (response: Response) => void;
		const refreshResponse = new Promise<Response>((resolve) => {
			resolveRefresh = resolve;
		});
		const { fetchSpy } = await bootDashboard({
			sources: [{
				id: 'source-1',
				kind: 'rss',
				name: 'Root Feed',
				normalizedIdentifier: 'https://example.com/feed.xml',
				pollUrl: 'https://example.com/feed.xml',
				status: 'active',
			}],
			handleFetch: (url, method) => {
				if (url.endsWith('/sources/source-1/refresh') && method === 'POST') {
					return refreshResponse;
				}
				return undefined;
			},
		});

		(document.getElementById('nav-sources') as HTMLButtonElement).click();
		await flush();
		await flush();

		const refreshButton = document.querySelector<HTMLButtonElement>('[data-action="refresh-source"][data-source-id="source-1"]');
		expect(refreshButton).not.toBeNull();
		refreshButton!.click();
		await Promise.resolve();

		expect(refreshButton?.disabled).toBe(true);
		expect(refreshButton?.textContent).toBe('Queueing…');

		resolveRefresh(jsonResponse({ queued: true, runId: 'run-1' }, 202));
		await flush();
		await flush();

		expect(fetchSpy).toHaveBeenCalledWith('/sources/source-1/refresh', expect.objectContaining({
			method: 'POST',
		}));
		expect(refreshButton?.disabled).toBe(false);
		expect(refreshButton?.textContent).toBe('Refresh');
		expect((document.getElementById('toast') as HTMLElement).textContent).toContain('Refresh queued');
	});

	it('shows the publisher date on feed article cards and in the reader', async () => {
		const createdAt = '2026-03-16T10:00:00.000Z';
		const publishedAt = '2026-08-06T09:30:00.000Z';
		await bootDashboard({
			handleFetch: (url, method) => {
				if (url.endsWith('/bookmarks') && method === 'GET') {
					return jsonResponse({ keys: [{
						id: 'bookmark-published',
						metadata: {
							createdAt,
							publishedAt,
							title: 'Publisher dated article',
							url: 'https://example.com/published',
							wordCount: 400,
						},
					}] });
				}
				if (url.endsWith('/bookmarks/bookmark-published') && method === 'GET') {
					return jsonResponse({
						id: 'bookmark-published',
						markdownData: '# Publisher dated article',
						metadata: { createdAt, publishedAt, title: 'Publisher dated article', url: 'https://example.com/published', wordCount: 400 },
					});
				}
				return undefined;
			},
		});

		const cardMeta = document.querySelector<HTMLElement>('[data-bookmark-id="bookmark-published"] [data-role="bookmark-meta"]');
		expect(cardMeta?.textContent).toContain(new Date(publishedAt).toLocaleDateString());
		expect(cardMeta?.textContent).not.toContain(new Date(createdAt).toLocaleDateString());
		document.querySelector<HTMLElement>('[data-bookmark-id="bookmark-published"]')?.click();
		await flush();
		await flush();

		expect((document.getElementById('view-date') as HTMLElement).textContent).toBe(`Published ${new Date(publishedAt).toLocaleString()}`);
	});

	it('labels the import date as saved when publisher metadata is absent', async () => {
		const createdAt = '2026-03-16T10:00:00.000Z';
		await bootDashboard({
			handleFetch: (url, method) => {
				if (url.endsWith('/bookmarks') && method === 'GET') {
					return jsonResponse({ keys: [{
						id: 'bookmark-saved',
						metadata: { createdAt, title: 'Saved page', url: 'https://example.com/saved', wordCount: 200 },
					}] });
				}
				if (url.endsWith('/bookmarks/bookmark-saved') && method === 'GET') {
					return jsonResponse({
						id: 'bookmark-saved',
						markdownData: '# Saved page',
						metadata: { createdAt, title: 'Saved page', url: 'https://example.com/saved', wordCount: 200 },
					});
				}
				return undefined;
			},
		});

		document.querySelector<HTMLElement>('[data-bookmark-id="bookmark-saved"]')?.click();
		await flush();
		await flush();

		expect((document.getElementById('view-date') as HTMLElement).textContent).toBe(`Saved ${new Date(createdAt).toLocaleString()}`);
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
				normalizedIdentifier: 'https://feeds.example.com/private/rss/long-source-identifier-without-breaks',
				status: 'active',
			}],
		});

		(document.getElementById('nav-sources') as HTMLButtonElement).click();
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
		const sourceRow = document.querySelector<HTMLElement>('[data-source-id="source-1"]');
		expect(sourceRow?.classList.contains('mcp-source-row')).toBe(true);
		expect(sourceRow?.querySelector('.mcp-source-summary')?.textContent).toContain('long-source-identifier-without-breaks');
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
		window.localStorage.setItem('keeproot_remembered_username', 'alice');
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
		expect(window.sessionStorage.getItem('keeproot_secret')).toBe('session-secret');
		expect(window.localStorage.getItem('keeproot_secret')).toBeNull();
		expect(window.localStorage.getItem('keeproot_theme')).toBe('auto');
		expect(window.localStorage.getItem('keeproot_font')).toBe('default');
		expect(window.localStorage.getItem('keeproot_font_size')).toBe('16');
		expect(window.localStorage.getItem('keeproot_notifications')).toBe('true');
		expect(window.localStorage.getItem('keeproot_remembered_username')).toBeNull();
		expect(window.localStorage.getItem('keeproot_highlights_bookmark-1')).toBeNull();
		expect((document.getElementById('api-keys-list') as HTMLElement).textContent).toContain('No active API keys.');
		expect((document.getElementById('current-view-title') as HTMLElement).textContent).toBe('Settings');
	});

	it('warns about expired API keys in the API key view', async () => {
		await bootDashboard({
			apiKeys: [{
				createdAt: '2025-03-16T10:00:00.000Z',
				expired: true,
				expiresAt: '2026-03-16T10:00:00.000Z',
				id: 'expired-key',
				name: 'Old extension',
			}],
		});

		(document.getElementById('setup-btn') as HTMLButtonElement).click();
		await flush();
		await flush();

		expect((document.getElementById('api-keys-list') as HTMLElement).textContent).toContain('Expired');
		expect((document.getElementById('toast') as HTMLElement).textContent).toContain('1 API key has expired');
	});

	it('revokes all sessions from settings and clears the current login', async () => {
		await bootDashboard({
			handleFetch: (url, method) => {
				if (url.endsWith('/auth/logout-all') && method === 'POST') {
					return jsonResponse({ revoked: 2 });
				}
				return undefined;
			},
		});

		(document.getElementById('open-settings-btn') as HTMLButtonElement).click();
		(document.getElementById('logout-all-btn') as HTMLButtonElement).click();
		await flush();
		await flush();

		expect(fetch).toHaveBeenCalledWith('/auth/logout-all', expect.objectContaining({
			headers: expect.any(Headers),
			method: 'POST',
		}));
		expect(window.sessionStorage.getItem('keeproot_secret')).toBeNull();
	});

	it('does nothing when clear all data confirmation is cancelled', async () => {
		await bootDashboard();
		vi.mocked(window.confirm).mockReturnValue(false);

		(document.getElementById('open-settings-btn') as HTMLButtonElement).click();
		await flush();

		(document.getElementById('clear-data-btn') as HTMLButtonElement).click();
		await flush();

		expect(fetch).not.toHaveBeenCalledWith('/account/data', expect.anything());
		expect(window.sessionStorage.getItem('keeproot_secret')).toBe('session-secret');
	});

	it('keeps the active bookmark unread until another bookmark is selected', async () => {
		const readState = new Map([
			['bookmark-1', false],
			['bookmark-2', false],
		]);

		const { fetchSpy } = await bootDashboard({
			handleFetch: (url, method, init) => {
				if (url.endsWith('/bookmarks') && method === 'GET') {
					return jsonResponse({
						keys: ['bookmark-1', 'bookmark-2'].map((id, index) => ({
							id,
							metadata: {
								createdAt: '2026-03-16T10:00:00.000Z',
								isRead: readState.get(id),
								title: `Unread article ${index + 1}`,
								url: `https://example.com/articles/unread-${index + 1}`,
								wordCount: 400,
							},
						})),
					});
				}

				const bookmarkMatch = url.match(/\/bookmarks\/(bookmark-[12])$/);
				if (bookmarkMatch && method === 'GET') {
					const id = bookmarkMatch[1];
					const articleNumber = id === 'bookmark-1' ? 1 : 2;
					return jsonResponse({
						id,
						markdownData: `# Unread article ${articleNumber}`,
						metadata: {
							createdAt: '2026-03-16T10:00:00.000Z',
							isRead: readState.get(id),
							title: `Unread article ${articleNumber}`,
							url: `https://example.com/articles/unread-${articleNumber}`,
							wordCount: 400,
						},
					});
				}

				if (bookmarkMatch && method === 'PATCH') {
					expect(init?.body).toBe(JSON.stringify({ isRead: true }));
					readState.set(bookmarkMatch[1], true);
					return jsonResponse({ message: 'Updated successfully' });
				}

				return undefined;
			},
		});

		const bookmarkCard = document.querySelector<HTMLElement>('[data-bookmark-id="bookmark-1"]');
		expect(bookmarkCard).not.toBeNull();
		expect(bookmarkCard?.tabIndex).toBe(0);
		expect(bookmarkCard?.getAttribute('aria-label')).toBe('Open Unread article 1');

		bookmarkCard?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
		await flush();
		await flush();
		await flush();

		expect(fetchSpy).not.toHaveBeenCalledWith('/bookmarks/bookmark-1', expect.objectContaining({
			headers: expect.any(Headers),
			method: 'PATCH',
		}));
		expect(readState.get('bookmark-1')).toBe(false);
		expect((document.getElementById('current-view-title') as HTMLElement).textContent).toBe('Reader');
		expect((document.getElementById('library-workspace') as HTMLElement).classList.contains('is-hidden')).toBe(false);
		expect((document.getElementById('inbox-view') as HTMLElement).classList.contains('is-hidden')).toBe(false);
		expect((document.getElementById('content-view') as HTMLElement).classList.contains('is-hidden')).toBe(false);

		document.querySelector<HTMLElement>('[data-bookmark-id="bookmark-2"]')?.click();
		await flush();
		await flush();
		await flush();

		expect(fetchSpy).toHaveBeenCalledWith('/bookmarks/bookmark-1', expect.objectContaining({
			headers: expect.any(Headers),
			method: 'PATCH',
		}));
		expect(fetchSpy).not.toHaveBeenCalledWith('/bookmarks/bookmark-2', expect.objectContaining({
			headers: expect.any(Headers),
			method: 'PATCH',
		}));
		expect(readState.get('bookmark-1')).toBe(true);
		expect(readState.get('bookmark-2')).toBe(false);
	});

	it('keeps a bookmark visible after pinning by moving it into the pinned panel', async () => {
		let bookmarkPinned = false;

		const { fetchSpy } = await bootDashboard({
			handleFetch: (url, method, init) => {
				if (url.endsWith('/bookmarks') && method === 'GET') {
					return jsonResponse({
						keys: [{
							id: 'bookmark-1',
							metadata: {
								createdAt: '2026-03-16T10:00:00.000Z',
								pinned: bookmarkPinned,
								title: 'Pin me',
								url: 'https://example.com/articles/pin-me',
								wordCount: 400,
							},
						}],
					});
				}

				if (url.endsWith('/bookmarks/bookmark-1') && method === 'PATCH') {
					expect(init?.body).toBe(JSON.stringify({ pinned: true }));
					bookmarkPinned = true;
					return jsonResponse({ message: 'Updated successfully' });
				}

				return undefined;
			},
		});

		const pinButton = document.querySelector('[data-action="toggle-pin"]') as HTMLButtonElement | null;
		expect(pinButton).not.toBeNull();

		pinButton?.click();
		await flush();
		await flush();

		expect(fetchSpy).toHaveBeenCalledWith('/bookmarks/bookmark-1', expect.objectContaining({
			headers: expect.any(Headers),
			method: 'PATCH',
		}));
		expect((document.getElementById('pinned-bookmark-list') as HTMLElement).textContent).toContain('Pin me');
		expect((document.getElementById('bookmark-list') as HTMLElement).textContent).not.toContain('Pin me');
		expect((document.getElementById('pinned-bookmark-list')?.closest('.bookmark-panel') as HTMLElement).classList.contains('is-hidden')).toBe(false);
	});

	it('does not overlap silent polling refreshes', async () => {
		let bookmarkListCalls = 0;
		let resolvePollingBookmarks: (() => void) | null = null;
		let pollingCallback: (() => void) | null = null;

		await bootDashboard({
			beforeImport: () => {
				vi.spyOn(window, 'setInterval').mockImplementation((callback: TimerHandler) => {
					pollingCallback = callback as () => void;
					return 1;
				});
				vi.spyOn(window, 'clearInterval').mockImplementation(() => {});
			},
			handleFetch: (url, method) => {
				if (url.endsWith('/bookmarks') && method === 'GET') {
					bookmarkListCalls += 1;
					if (bookmarkListCalls === 1) {
						return jsonResponse({ keys: [] });
					}

					return new Promise<Response>((resolve) => {
						resolvePollingBookmarks = () => resolve(jsonResponse({ keys: [] }));
					});
				}

				return undefined;
			},
		});

		expect(pollingCallback).toBeTypeOf('function');
		expect(bookmarkListCalls).toBe(1);

		pollingCallback?.();
		pollingCallback?.();
		await flush();

		expect(bookmarkListCalls).toBe(2);
		resolvePollingBookmarks?.();
		await flush();
	});

	it('prevents duplicate API key creation submissions while a request is pending', async () => {
		let resolveCreateKey: (() => void) | null = null;
		let createKeyCalls = 0;

		await bootDashboard({
			handleFetch: (url, method) => {
				if (url.endsWith('/api-keys') && method === 'POST') {
					createKeyCalls += 1;
					return new Promise<Response>((resolve) => {
						resolveCreateKey = () => resolve(jsonResponse({
							metadata: {
								createdAt: '2026-03-16T10:00:00.000Z',
								id: 'key-1',
								name: 'Duplicate Guard',
							},
							secret: 'new-secret',
						}));
					});
				}

				if (url.endsWith('/api-keys') && method === 'GET') {
					return jsonResponse({ keys: [] });
				}

				return undefined;
			},
		});

		(document.getElementById('setup-btn') as HTMLButtonElement).click();
		await flush();

		const form = document.getElementById('generate-key-form') as HTMLFormElement;
		(document.getElementById('new-key-name') as HTMLInputElement).value = 'Duplicate Guard';
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await flush();

		expect(createKeyCalls).toBe(1);
		expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);

		resolveCreateKey?.();
		await flush();

		expect((document.getElementById('new-key-value') as HTMLInputElement).value).toBe('new-secret');
		expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
	});
});
