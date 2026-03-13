import './styles.css';
import { loginWithPasskey, registerWithPasskey } from './lib/auth';
import { ApiError, KeepRootApi } from './lib/api';
import { getDom } from './lib/dom';
import { collectTags, filterBookmarks } from './lib/filters';
import { renderMarkdown } from './lib/markdown';
import { registerServiceWorker } from './lib/service-worker';
import { buildDataSnapshot, createAppState, getBookmarkId, type ApiKeyRecord, type BookmarkDetail, type BookmarkSummary, type HighlightRecord, type SmartListSummary, type ViewName } from './lib/state';
import { clearSessionToken, loadHighlights, loadPreferences, loadSessionToken, saveHighlights, savePreference, saveSessionToken } from './lib/storage';

const dom = getDom();
const state = createAppState(loadPreferences());
const api = new KeepRootApi(() => state.secret);

let editingListId: string | null = null;
let editingListType: 'list' | 'smartlist' | null = null;
let currentHighlightId: string | null = null;
let currentHighlightSelection = '';
let lastSnapshot = '';
let toastTimeout = 0;

function showToast(message: string, tone: 'error' | 'success' = 'success') {
	dom.toast.textContent = message;
	dom.toast.dataset.tone = tone;
	dom.toast.classList.add('is-visible');
	window.clearTimeout(toastTimeout);
	toastTimeout = window.setTimeout(() => {
		dom.toast.classList.remove('is-visible');
	}, 5000);
}

function getResolvedTheme(theme: 'auto' | 'dark' | 'light'): 'dark' | 'light' {
	if (theme !== 'auto') {
		return theme;
	}
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: 'auto' | 'dark' | 'light') {
	state.preferences.theme = theme;
	savePreference('theme', theme);
	document.documentElement.dataset.colorScheme = getResolvedTheme(theme);
	document.querySelectorAll<HTMLElement>('.theme-option').forEach((element) => {
		element.classList.toggle('is-active', element.dataset.themeVal === theme);
	});
}

function applyFont(font: 'default' | 'dyslexic' | 'sans') {
	state.preferences.font = font;
	savePreference('font', font);
	document.documentElement.dataset.font = font;
	document.querySelectorAll<HTMLElement>('.font-option').forEach((element) => {
		element.classList.toggle('is-active', element.dataset.fontVal === font);
	});
}

function applyFontSize(fontSize: number) {
	state.preferences.fontSize = Math.min(32, Math.max(12, fontSize));
	savePreference('fontSize', state.preferences.fontSize);
	document.documentElement.style.setProperty('--reader-font-size', `${state.preferences.fontSize}px`);
	dom.fontSizeValue.textContent = `${state.preferences.fontSize} px`;
}

function showLogin() {
	dom.app.classList.add('is-hidden');
	if (!dom.loginModal.open) {
		dom.loginModal.showModal();
	}
}

function showApp() {
	if (dom.loginModal.open) {
		dom.loginModal.close();
	}
	dom.app.classList.remove('is-hidden');
}

function updateNavigationState() {
	dom.navInbox.classList.toggle('nav-link--active', state.currentView === 'inbox' && state.filterType === 'inbox');
	dom.navAll.classList.toggle('nav-link--active', state.currentView === 'inbox' && state.filterType === 'all');
	dom.setupBtn.classList.toggle('nav-link--active', state.currentView === 'setup');
	dom.openSettingsBtn.classList.toggle('nav-link--active', state.currentView === 'settings');

	document.querySelectorAll<HTMLElement>('.sidebar-item').forEach((element) => {
		const isActive = state.currentView === 'inbox'
			&& element.dataset.filterType === state.filterType
			&& String(element.dataset.filterId ?? '') === String(state.filterId ?? '');
		element.classList.toggle('is-active', isActive);
	});
}

function updateListHeaderActions() {
	const showActions = state.currentView === 'inbox' && (state.filterType === 'list' || state.filterType === 'smartlist');
	dom.listHeaderActions.classList.toggle('is-hidden', !showActions);
}

function switchView(viewName: ViewName, filterType = state.filterType, filterId = state.filterId) {
	state.currentView = viewName;

	dom.emptyState.classList.toggle('is-hidden', viewName !== 'empty');
	dom.inboxView.classList.toggle('is-hidden', viewName !== 'inbox');
	dom.contentView.classList.toggle('is-hidden', viewName !== 'content');
	dom.setupView.classList.toggle('is-hidden', viewName !== 'setup');
	dom.settingsView.classList.toggle('is-hidden', viewName !== 'settings');

	if (viewName === 'inbox') {
		state.filterType = filterType;
		state.filterId = filterId;

		if (filterType === 'inbox') {
			dom.currentViewTitle.textContent = 'Inbox';
		} else if (filterType === 'all') {
			dom.currentViewTitle.textContent = 'All Bookmarks';
		} else if (filterType === 'list') {
			dom.currentViewTitle.textContent = state.lists.find((list) => list.id === filterId)?.name ?? 'List';
		} else if (filterType === 'smartlist') {
			dom.currentViewTitle.textContent = state.smartLists.find((list) => list.id === filterId)?.name ?? 'Smart List';
		} else if (filterType === 'tag') {
			dom.currentViewTitle.textContent = `# ${filterId}`;
		}

		renderBookmarkLists();
	} else if (viewName === 'setup') {
		dom.currentViewTitle.textContent = 'API Keys';
		void fetchApiKeys();
	} else if (viewName === 'settings') {
		dom.currentViewTitle.textContent = 'Settings';
	} else if (viewName === 'content') {
		dom.currentViewTitle.textContent = 'Reader';
	} else {
		state.currentBookmarkId = null;
		dom.currentViewTitle.textContent = 'Dashboard';
	}

	updateListHeaderActions();
	updateNavigationState();
}

function createSidebarButton(options: {
	active: boolean;
	filterId: string;
	filterType: 'list' | 'smartlist' | 'tag';
	icon: string;
	indent?: number;
	label: string;
}) {
	const fragment = dom.sidebarTemplate.content.cloneNode(true) as DocumentFragment;
	const button = fragment.querySelector<HTMLButtonElement>('button');
	const icon = fragment.querySelector<HTMLElement>('[data-role="sidebar-icon"]');
	const label = fragment.querySelector<HTMLElement>('[data-role="sidebar-label"]');
	if (!button || !icon || !label) {
		throw new Error('Sidebar template is invalid');
	}

	button.dataset.filterId = options.filterId;
	button.dataset.filterType = options.filterType;
	button.classList.toggle('is-active', options.active);
	if (options.indent) {
		button.style.paddingLeft = `${0.9 + options.indent * 0.7}rem`;
	}
	icon.textContent = options.icon;
	label.textContent = options.label;
	return button;
}

function renderSidebar() {
	dom.sidebarLists.innerHTML = '';
	dom.sidebarSmartLists.innerHTML = '';
	dom.sidebarTags.innerHTML = '';

	if (!state.lists.length) {
		dom.sidebarLists.innerHTML = '<p class="muted-copy">No lists yet.</p>';
	} else {
		for (const list of state.lists) {
			dom.sidebarLists.appendChild(createSidebarButton({
				active: state.filterType === 'list' && state.filterId === list.id,
				filterId: list.id,
				filterType: 'list',
				icon: 'L',
				label: list.name,
			}));
		}
	}

	if (!state.smartLists.length) {
		dom.sidebarSmartLists.innerHTML = '<p class="muted-copy">No smart lists yet.</p>';
	} else {
		for (const list of state.smartLists) {
			dom.sidebarSmartLists.appendChild(createSidebarButton({
				active: state.filterType === 'smartlist' && state.filterId === list.id,
				filterId: list.id,
				filterType: 'smartlist',
				icon: list.icon ?? 'S',
				label: list.name,
			}));
		}
	}

	if (!state.tags.length) {
		dom.sidebarTags.innerHTML = '<p class="muted-copy">No tags yet.</p>';
	} else {
		for (const tag of state.tags) {
			const parts = tag.split('/');
			dom.sidebarTags.appendChild(createSidebarButton({
				active: state.filterType === 'tag' && state.filterId === tag,
				filterId: tag,
				filterType: 'tag',
				icon: '#',
				indent: parts.length - 1,
				label: parts[parts.length - 1],
			}));
		}
	}
}

function createBookmarkCard(bookmark: BookmarkSummary) {
	const fragment = dom.bookmarkTemplate.content.cloneNode(true) as DocumentFragment;
	const card = fragment.querySelector<HTMLElement>('.bookmark-card');
	const title = fragment.querySelector<HTMLElement>('[data-role="bookmark-title"]');
	const meta = fragment.querySelector<HTMLElement>('[data-role="bookmark-meta"]');
	const tags = fragment.querySelector<HTMLDivElement>('[data-role="bookmark-tags"]');
	const statusButton = fragment.querySelector<HTMLButtonElement>('[data-action="toggle-read"]');
	const pinButton = fragment.querySelector<HTMLButtonElement>('[data-action="toggle-pin"]');
	if (!card || !title || !meta || !tags || !statusButton || !pinButton) {
		throw new Error('Bookmark template is invalid');
	}

	const bookmarkId = getBookmarkId(bookmark);
	const bookmarkTags = Array.isArray(bookmark.metadata?.tags) ? bookmark.metadata.tags : [];
	const createdAt = bookmark.metadata?.createdAt ? new Date(bookmark.metadata.createdAt) : null;
	const wordCount = Number(bookmark.metadata?.wordCount ?? 0);
	const readingTime = Math.max(1, Math.ceil(wordCount / 200));
	const domain = bookmark.metadata?.url ? new URL(bookmark.metadata.url).hostname : 'Unknown source';

	card.dataset.bookmarkId = bookmarkId;
	card.classList.toggle('is-active', state.currentBookmarkId === bookmarkId);

	title.textContent = String(bookmark.metadata?.title ?? 'Untitled');
	meta.textContent = `${createdAt ? createdAt.toLocaleDateString() : 'Unknown date'} · ${readingTime} min · ${domain}`;
	statusButton.textContent = bookmark.metadata?.isRead ? 'Read' : 'Unread';
	statusButton.classList.toggle('is-read', Boolean(bookmark.metadata?.isRead));
	pinButton.textContent = bookmark.metadata?.pinned ? 'Pinned' : 'Pin';
	pinButton.classList.toggle('is-pinned', Boolean(bookmark.metadata?.pinned));

	if (!bookmarkTags.length) {
		tags.innerHTML = '';
	} else {
		for (const tag of bookmarkTags) {
			const pill = document.createElement('span');
			pill.className = 'tag-pill';
			pill.textContent = tag;
			tags.appendChild(pill);
		}
	}

	return card;
}

function renderBookmarkLists() {
	if (state.currentView !== 'inbox') {
		return;
	}

	const filtered = filterBookmarks({
		bookmarks: state.bookmarks,
		filterId: state.filterId,
		filterType: state.filterType,
		query: dom.searchInput.value,
		smartLists: state.smartLists,
	});

	dom.listItemCount.textContent = `${filtered.length} items`;
	dom.bookmarkList.innerHTML = '';
	dom.pinnedBookmarkList.innerHTML = '';

	if (!filtered.length) {
		dom.bookmarkList.innerHTML = '<div class="panel"><p class="muted-copy">No bookmarks match this view.</p></div>';
		return;
	}

	for (const bookmark of filtered) {
		const target = bookmark.metadata?.pinned ? dom.pinnedBookmarkList : dom.bookmarkList;
		target.appendChild(createBookmarkCard(bookmark));
	}
}

function renderApiKeys(keys: ApiKeyRecord[]) {
	dom.apiKeysList.innerHTML = '';

	if (!keys.length) {
		dom.apiKeysList.innerHTML = '<p class="muted-copy">No active API keys.</p>';
		return;
	}

	for (const key of keys) {
		const fragment = dom.apiKeyTemplate.content.cloneNode(true) as DocumentFragment;
		const root = fragment.querySelector<HTMLElement>('.stack-item');
		const name = fragment.querySelector<HTMLElement>('[data-role="api-key-name"]');
		const date = fragment.querySelector<HTMLElement>('[data-role="api-key-date"]');
		const deleteButton = fragment.querySelector<HTMLButtonElement>('[data-action="delete-api-key"]');
		if (!root || !name || !date || !deleteButton) {
			throw new Error('API key template is invalid');
		}

		root.dataset.apiKeyId = key.id;
		name.textContent = key.name;
		date.textContent = `Created ${new Date(key.createdAt).toLocaleDateString()}`;
		deleteButton.dataset.apiKeyId = key.id;
		dom.apiKeysList.appendChild(root);
	}
}

function renderReaderStats(bookmark: BookmarkDetail) {
	const wordCount = Number(bookmark.metadata?.wordCount ?? 0);
	const readingTime = Math.max(1, Math.ceil(wordCount / 200));
	dom.viewDomain.textContent = bookmark.metadata?.url ? new URL(bookmark.metadata.url).hostname : '—';
	dom.viewStatus.textContent = String(bookmark.metadata?.status ?? 'saved');
	dom.viewWordCount.textContent = String(wordCount);
	dom.viewReadingTime.textContent = `${readingTime} min`;
}

async function loadBookmark(bookmarkId: string) {
	state.currentBookmarkId = bookmarkId;
	switchView('content');

	dom.markdownContainer.innerHTML = '<div class="panel"><p class="muted-copy">Loading bookmark…</p></div>';
	dom.viewTitle.textContent = 'Loading…';
	dom.viewUrl.style.display = 'none';
	dom.viewDate.textContent = '';
	dom.viewTags.innerHTML = '';

	try {
		const bookmark = await api.getBookmark(bookmarkId);
		const highlights = loadHighlights(bookmarkId);

		dom.viewTitle.textContent = String(bookmark.metadata?.title ?? 'Untitled');
		if (bookmark.metadata?.url) {
			dom.viewUrl.href = bookmark.metadata.url;
			dom.viewUrl.textContent = new URL(bookmark.metadata.url).hostname;
			dom.viewUrl.style.display = 'inline-flex';
		} else {
			dom.viewUrl.style.display = 'none';
		}

		if (bookmark.metadata?.createdAt) {
			const updatedText = bookmark.metadata?.updatedAt && bookmark.metadata.updatedAt !== bookmark.metadata.createdAt
				? ` · Updated ${new Date(bookmark.metadata.updatedAt).toLocaleString()}`
				: '';
			dom.viewDate.textContent = `${new Date(bookmark.metadata.createdAt).toLocaleString()}${updatedText}`;
		}

		const tags = Array.isArray(bookmark.metadata?.tags) ? bookmark.metadata.tags : [];
		if (!tags.length) {
			dom.viewTags.innerHTML = '<span class="muted-copy">No tags</span>';
		} else {
			dom.viewTags.innerHTML = '';
			for (const tag of tags) {
				const pill = document.createElement('span');
				pill.className = 'tag-pill';
				pill.textContent = tag;
				dom.viewTags.appendChild(pill);
			}
		}

		renderReaderStats(bookmark);
		dom.markdownContainer.innerHTML = renderMarkdown(bookmark.markdownData, highlights);
		renderBookmarkLists();
	} catch (error) {
		dom.markdownContainer.innerHTML = '<div class="panel"><p class="muted-copy">Failed to load bookmark content.</p></div>';
		showToast(error instanceof Error ? error.message : 'Failed to load bookmark', 'error');
	}
}

async function fetchApiKeys() {
	try {
		const response = await api.listApiKeys();
		state.apiKeys = response.keys ?? [];
		renderApiKeys(state.apiKeys);
	} catch (error) {
		dom.apiKeysList.innerHTML = '<p class="muted-copy">Failed to load API keys.</p>';
		showToast(error instanceof Error ? error.message : 'Failed to load API keys', 'error');
	}
}

function updateSummaryStats() {
	dom.statTotal.textContent = String(state.bookmarks.length);
	dom.statRecent.textContent = String(
		state.bookmarks.filter((bookmark) => {
			const createdAt = bookmark.metadata?.createdAt ? new Date(bookmark.metadata.createdAt).getTime() : 0;
			return createdAt > Date.now() - 24 * 60 * 60 * 1000;
		}).length,
	);
}

async function refreshData(isSilent = false) {
	if (!isSilent) {
		dom.bookmarkList.innerHTML = '<div class="panel"><p class="muted-copy">Loading bookmarks…</p></div>';
	}

	try {
		const [bookmarkResult, listResult, smartListResult] = await Promise.allSettled([
			api.listBookmarks(),
			api.listLists(),
			api.listSmartLists(),
		]);

		if (bookmarkResult.status === 'rejected') {
			throw bookmarkResult.reason;
		}

		const bookmarks = bookmarkResult.value.keys ?? [];
		const lists = listResult.status === 'fulfilled' ? listResult.value.lists ?? [] : [];
		const smartLists = smartListResult.status === 'fulfilled' ? smartListResult.value.lists ?? [] : [];
		const nextSnapshot = buildDataSnapshot(bookmarks, lists, smartLists);

		if (!isSilent || nextSnapshot !== lastSnapshot) {
			state.bookmarks = bookmarks;
			state.lists = lists;
			state.smartLists = smartLists as SmartListSummary[];
			state.tags = collectTags(bookmarks);
			lastSnapshot = nextSnapshot;
			renderSidebar();
			renderBookmarkLists();
			updateSummaryStats();
		}
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) {
			logout();
			return;
		}

		if (!isSilent) {
			dom.bookmarkList.innerHTML = '<div class="panel"><p class="muted-copy">Failed to load dashboard data.</p></div>';
		}
		showToast(error instanceof Error ? error.message : 'Failed to load data', 'error');
	}
}

function startPolling() {
	if (state.pollingHandle) {
		return;
	}

	state.pollingHandle = window.setInterval(() => {
		void refreshData(true);
	}, 5000);
}

function stopPolling() {
	if (!state.pollingHandle) {
		return;
	}
	window.clearInterval(state.pollingHandle);
	state.pollingHandle = null;
}

function closeDialog(dialog: HTMLDialogElement) {
	if (dialog.open) {
		dialog.close();
	}
}

function openDialog(dialog: HTMLDialogElement) {
	if (!dialog.open) {
		dialog.showModal();
	}
}

function logout() {
	clearSessionToken();
	state.secret = null;
	state.currentBookmarkId = null;
	stopPolling();
	showLogin();
	switchView('empty');
	showToast('Logged out', 'success');
}

function loginSuccess(token: string) {
	state.secret = token;
	saveSessionToken(token);
	showApp();
	switchView('inbox', 'inbox', null);
	void refreshData();
	startPolling();
	showToast('Logged in successfully', 'success');
}

function getHighlightsForCurrentBookmark(): HighlightRecord[] {
	return state.currentBookmarkId ? loadHighlights(state.currentBookmarkId) : [];
}

function saveCurrentHighlights(highlights: HighlightRecord[]) {
	if (!state.currentBookmarkId) {
		return;
	}
	saveHighlights(state.currentBookmarkId, highlights);
}

function hideHighlightTooltip() {
	dom.highlightTooltip.classList.add('is-hidden');
}

async function handleBookmarkCardAction(action: string, bookmarkId: string) {
	try {
		const bookmark = state.bookmarks.find((item) => getBookmarkId(item) === bookmarkId);
		if (!bookmark) {
			return;
		}

		if (action === 'toggle-read') {
			await api.updateBookmark(bookmarkId, { isRead: !bookmark.metadata?.isRead });
			await refreshData(true);
			if (state.currentBookmarkId === bookmarkId) {
				await loadBookmark(bookmarkId);
			}
			return;
		}

		if (action === 'toggle-pin') {
			await api.updateBookmark(bookmarkId, { pinned: !bookmark.metadata?.pinned });
			await refreshData(true);
			return;
		}
	} catch (error) {
		showToast(error instanceof Error ? error.message : 'Bookmark update failed', 'error');
	}
}

function bindEvents() {
	dom.brandTitle.addEventListener('click', () => switchView('empty'));
	dom.navInbox.addEventListener('click', () => switchView('inbox', 'inbox', null));
	dom.navAll.addEventListener('click', () => switchView('inbox', 'all', null));
	dom.setupBtn.addEventListener('click', () => switchView('setup'));
	dom.openSettingsBtn.addEventListener('click', () => switchView('settings'));
	dom.logoutBtn.addEventListener('click', logout);

	dom.passkeyForm.addEventListener('submit', async (event) => {
		event.preventDefault();
		const username = dom.usernameInput.value.trim();
		if (!username) {
			showToast('Enter a username first', 'error');
			return;
		}

		try {
			dom.btnLogin.disabled = true;
			dom.btnLogin.textContent = 'Verifying…';
			loginSuccess(await loginWithPasskey(api, username));
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Login failed', 'error');
		} finally {
			dom.btnLogin.disabled = false;
			dom.btnLogin.textContent = 'Login';
		}
	});

	dom.btnRegister.addEventListener('click', async () => {
		const username = dom.usernameInput.value.trim();
		if (!username) {
			showToast('Enter a username first', 'error');
			return;
		}

		try {
			dom.btnRegister.disabled = true;
			dom.btnRegister.textContent = 'Registering…';
			loginSuccess(await registerWithPasskey(api, username));
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Registration failed', 'error');
		} finally {
			dom.btnRegister.disabled = false;
			dom.btnRegister.textContent = 'Register';
		}
	});

	dom.searchInput.addEventListener('input', () => {
		if (state.currentView === 'empty') {
			switchView('inbox', 'all', null);
			return;
		}
		renderBookmarkLists();
	});

	dom.toggleStatsBtn.addEventListener('click', () => {
		const isHidden = dom.statsPanel.classList.toggle('is-hidden');
		dom.toggleStatsBtn.setAttribute('aria-pressed', String(!isHidden));
	});

	dom.fontDecreaseBtn.addEventListener('click', () => applyFontSize(state.preferences.fontSize - 2));
	dom.fontIncreaseBtn.addEventListener('click', () => applyFontSize(state.preferences.fontSize + 2));
	dom.notificationToggle.addEventListener('change', () => {
		state.preferences.notifications = dom.notificationToggle.checked;
		savePreference('notifications', state.preferences.notifications);
	});

	document.querySelectorAll<HTMLButtonElement>('.theme-option').forEach((button) => {
		button.addEventListener('click', () => applyTheme(button.dataset.themeVal as 'auto' | 'dark' | 'light'));
	});

	document.querySelectorAll<HTMLButtonElement>('.font-option').forEach((button) => {
		button.addEventListener('click', () => applyFont(button.dataset.fontVal as 'default' | 'dyslexic' | 'sans'));
	});

	dom.sidebarLists.addEventListener('click', (event) => {
		const button = (event.target as Element).closest<HTMLButtonElement>('[data-filter-id]');
		if (!button) {
			return;
		}
		switchView('inbox', 'list', button.dataset.filterId ?? null);
	});

	dom.sidebarSmartLists.addEventListener('click', (event) => {
		const button = (event.target as Element).closest<HTMLButtonElement>('[data-filter-id]');
		if (!button) {
			return;
		}
		switchView('inbox', 'smartlist', button.dataset.filterId ?? null);
	});

	dom.sidebarTags.addEventListener('click', (event) => {
		const button = (event.target as Element).closest<HTMLButtonElement>('[data-filter-id]');
		if (!button) {
			return;
		}
		switchView('inbox', 'tag', button.dataset.filterId ?? null);
	});

	const bookmarkContainers = [dom.bookmarkList, dom.pinnedBookmarkList];
	for (const container of bookmarkContainers) {
		container.addEventListener('click', (event) => {
			const target = event.target as Element;
			const card = target.closest<HTMLElement>('.bookmark-card');
			if (!card?.dataset.bookmarkId) {
				return;
			}

			const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
			if (action) {
				void handleBookmarkCardAction(action, card.dataset.bookmarkId);
				return;
			}

			void loadBookmark(card.dataset.bookmarkId);
		});

		container.addEventListener('dragstart', (event) => {
			const card = (event.target as Element).closest<HTMLElement>('.bookmark-card');
			if (!card?.dataset.bookmarkId || !event.dataTransfer) {
				return;
			}

			event.dataTransfer.setData('application/x-bookmark-id', card.dataset.bookmarkId);
			card.classList.add('is-active');
		});

		container.addEventListener('dragend', (event) => {
			(event.target as Element).closest<HTMLElement>('.bookmark-card')?.classList.remove('is-active');
		});
	}

	dom.sidebarLists.addEventListener('dragover', (event) => {
		const button = (event.target as Element).closest<HTMLButtonElement>('[data-filter-id]');
		if (!button || !event.dataTransfer?.types.includes('application/x-bookmark-id')) {
			return;
		}
		event.preventDefault();
		button.classList.add('is-active');
	});

	dom.sidebarLists.addEventListener('dragleave', (event) => {
		(event.target as Element).closest<HTMLButtonElement>('[data-filter-id]')?.classList.remove('is-active');
	});

	dom.sidebarLists.addEventListener('drop', async (event) => {
		const button = (event.target as Element).closest<HTMLButtonElement>('[data-filter-id]');
		const bookmarkId = event.dataTransfer?.getData('application/x-bookmark-id');
		if (!button?.dataset.filterId || !bookmarkId) {
			return;
		}

		event.preventDefault();
		button.classList.remove('is-active');
		try {
			await api.updateBookmark(bookmarkId, { listId: button.dataset.filterId });
			await refreshData(true);
			showToast('Bookmark moved to list', 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Failed to move bookmark', 'error');
		}
	});

	dom.deleteBtn.addEventListener('click', async () => {
		if (!state.currentBookmarkId || !window.confirm('Delete this bookmark?')) {
			return;
		}

		try {
			await api.deleteBookmark(state.currentBookmarkId);
			state.currentBookmarkId = null;
			showToast('Bookmark deleted', 'success');
			switchView('inbox', state.filterType, state.filterId);
			await refreshData(true);
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Delete failed', 'error');
		}
	});

	dom.generateKeyForm.addEventListener('submit', async (event) => {
		event.preventDefault();
		const name = dom.newKeyName.value.trim();
		if (!name) {
			return;
		}

		try {
			const response = await api.createApiKey(name);
			dom.newKeyName.value = '';
			dom.newKeyValue.value = response.secret;
			dom.newKeyResult.classList.remove('is-hidden');
			await fetchApiKeys();
			showToast('API key created', 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Failed to create API key', 'error');
		}
	});

	dom.copyNewKeyBtn.addEventListener('click', async () => {
		await navigator.clipboard.writeText(dom.newKeyValue.value);
		showToast('API key copied to clipboard', 'success');
	});

	dom.apiKeysList.addEventListener('click', async (event) => {
		const button = (event.target as Element).closest<HTMLButtonElement>('[data-action="delete-api-key"]');
		if (!button?.dataset.apiKeyId || !window.confirm('Delete this key? Extensions using it will stop working immediately.')) {
			return;
		}

		try {
			await api.deleteApiKey(button.dataset.apiKeyId);
			await fetchApiKeys();
			showToast('API key deleted', 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Failed to delete API key', 'error');
		}
	});

	dom.addListBtn.addEventListener('click', () => {
		editingListId = null;
		editingListType = 'list';
		dom.listModalTitle.textContent = 'Create List';
		dom.listNameInput.value = '';
		openDialog(dom.listModal);
	});

	dom.addSmartListBtn.addEventListener('click', () => {
		editingListId = null;
		editingListType = 'smartlist';
		dom.smartListModalTitle.textContent = 'Create Smart List';
		dom.smartListNameInput.value = '';
		dom.smartListRulesInput.value = '';
		openDialog(dom.smartListModal);
	});

	dom.editListBtn.addEventListener('click', () => {
		if (!state.filterId) {
			return;
		}

		if (state.filterType === 'list') {
			const list = state.lists.find((item) => item.id === state.filterId);
			if (!list) {
				return;
			}
			editingListType = 'list';
			editingListId = list.id;
			dom.listModalTitle.textContent = 'Edit List';
			dom.listNameInput.value = list.name;
			openDialog(dom.listModal);
		}

		if (state.filterType === 'smartlist') {
			const list = state.smartLists.find((item) => item.id === state.filterId);
			if (!list) {
				return;
			}
			editingListType = 'smartlist';
			editingListId = list.id;
			dom.smartListModalTitle.textContent = 'Edit Smart List';
			dom.smartListNameInput.value = list.name;
			dom.smartListRulesInput.value = list.rules;
			openDialog(dom.smartListModal);
		}
	});

	dom.deleteListBtn.addEventListener('click', async () => {
		if (!state.filterId || !window.confirm('Delete this list? Bookmarks stay saved, but they will no longer belong to this list.')) {
			return;
		}

		try {
			if (state.filterType === 'list') {
				await api.deleteList(state.filterId);
			} else if (state.filterType === 'smartlist') {
				await api.deleteSmartList(state.filterId);
			}
			switchView('inbox', 'all', null);
			await refreshData(true);
			showToast('List deleted', 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Failed to delete list', 'error');
		}
	});

	dom.btnSaveList.addEventListener('click', async () => {
		const name = dom.listNameInput.value.trim();
		if (!name) {
			return;
		}

		try {
			if (editingListId) {
				await api.updateList(editingListId, { name });
				showToast('List updated', 'success');
			} else {
				await api.createList({ name });
				showToast('List created', 'success');
			}
			closeDialog(dom.listModal);
			await refreshData(true);
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Failed to save list', 'error');
		}
	});

	dom.btnSaveSmartList.addEventListener('click', async () => {
		const name = dom.smartListNameInput.value.trim();
		const rules = dom.smartListRulesInput.value.trim();
		if (!name || !rules) {
			return;
		}

		try {
			if (editingListId) {
				await api.updateSmartList(editingListId, { name, rules });
				showToast('Smart list updated', 'success');
			} else {
				await api.createSmartList({ name, rules });
				showToast('Smart list created', 'success');
			}
			closeDialog(dom.smartListModal);
			await refreshData(true);
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Failed to save smart list', 'error');
		}
	});

	dom.btnCancelList.addEventListener('click', () => closeDialog(dom.listModal));
	dom.btnCancelSmartList.addEventListener('click', () => closeDialog(dom.smartListModal));
	dom.btnCancelTags.addEventListener('click', () => closeDialog(dom.tagsModal));
	dom.btnCancelNote.addEventListener('click', () => closeDialog(dom.noteModal));

	dom.btnEditTags.addEventListener('click', () => {
		if (!state.currentBookmarkId) {
			return;
		}

		const bookmark = state.bookmarks.find((item) => getBookmarkId(item) === state.currentBookmarkId);
		dom.tagsInput.value = Array.isArray(bookmark?.metadata?.tags) ? bookmark.metadata.tags.join(', ') : '';
		openDialog(dom.tagsModal);
	});

	dom.btnSaveTags.addEventListener('click', async () => {
		if (!state.currentBookmarkId) {
			return;
		}

		try {
			const tags = dom.tagsInput.value.split(',').map((tag) => tag.trim()).filter(Boolean);
			await api.updateBookmark(state.currentBookmarkId, { tags });
			closeDialog(dom.tagsModal);
			await refreshData(true);
			await loadBookmark(state.currentBookmarkId);
			showToast('Tags updated', 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Failed to update tags', 'error');
		}
	});

	dom.markdownContainer.addEventListener('mouseup', (event) => {
		const selection = window.getSelection();
		const text = selection?.toString().trim() ?? '';
		if (!text || !selection?.anchorNode || !dom.markdownContainer.contains(selection.anchorNode)) {
			hideHighlightTooltip();
			return;
		}

		currentHighlightSelection = text;
		dom.highlightTooltip.style.left = `${event.pageX}px`;
		dom.highlightTooltip.style.top = `${event.pageY - 40}px`;
		dom.highlightTooltip.classList.remove('is-hidden');
	});

	document.addEventListener('mousedown', (event) => {
		const target = event.target as Element;
		if (dom.highlightTooltip.contains(target)) {
			return;
		}
		hideHighlightTooltip();
	});

	dom.btnAddHighlight.addEventListener('click', async () => {
		if (!state.currentBookmarkId || !currentHighlightSelection) {
			return;
		}

		const highlights = getHighlightsForCurrentBookmark();
		highlights.push({
			id: `hl-${Date.now()}`,
			note: '',
			text: currentHighlightSelection,
		});
		saveCurrentHighlights(highlights);
		hideHighlightTooltip();
		window.getSelection()?.removeAllRanges();
		await loadBookmark(state.currentBookmarkId);
	});

	dom.markdownContainer.addEventListener('click', (event) => {
		const highlight = (event.target as Element).closest<HTMLElement>('mark.highlight');
		if (!highlight?.dataset.id) {
			return;
		}

		currentHighlightId = highlight.dataset.id;
		const existing = getHighlightsForCurrentBookmark().find((item) => item.id === currentHighlightId);
		dom.noteInput.value = existing?.note ?? '';
		dom.btnDeleteHighlight.classList.remove('is-hidden');
		openDialog(dom.noteModal);
	});

	dom.btnSaveNote.addEventListener('click', async () => {
		if (!currentHighlightId || !state.currentBookmarkId) {
			return;
		}

		const highlights = getHighlightsForCurrentBookmark();
		const existing = highlights.find((item) => item.id === currentHighlightId);
		if (!existing) {
			return;
		}

		existing.note = dom.noteInput.value.trim();
		saveCurrentHighlights(highlights);
		closeDialog(dom.noteModal);
		await loadBookmark(state.currentBookmarkId);
	});

	dom.btnDeleteHighlight.addEventListener('click', async () => {
		if (!currentHighlightId || !state.currentBookmarkId) {
			return;
		}

		saveCurrentHighlights(getHighlightsForCurrentBookmark().filter((item) => item.id !== currentHighlightId));
		closeDialog(dom.noteModal);
		await loadBookmark(state.currentBookmarkId);
	});

	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
		if (state.preferences.theme === 'auto') {
			document.documentElement.dataset.colorScheme = getResolvedTheme('auto');
		}
	});
}

function hydrateInitialUI() {
	applyTheme(state.preferences.theme);
	applyFont(state.preferences.font);
	applyFontSize(state.preferences.fontSize);
	dom.notificationToggle.checked = state.preferences.notifications;
}

async function init() {
	bindEvents();
	hydrateInitialUI();
	state.secret = loadSessionToken();

	if (state.secret) {
		showApp();
		switchView('inbox', 'inbox', null);
		await refreshData();
		startPolling();
	} else {
		showLogin();
		switchView('empty');
	}

	await registerServiceWorker();
}

void init();
