const TRACKING_QUERY_KEYS = new Set([
	'fbclid',
	'gclid',
	'mc_cid',
	'mc_eid',
	'ref',
	'ref_src',
	'src',
]);

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const MAX_AUTO_FETCH_IMAGES = 12;
export const encoder = new TextEncoder();

export interface StorageEnv {
	ASSETS?: Fetcher;
	KEEPROOT_DB: D1Database;
	KEEPROOT_CONTENT: R2Bucket;
}

export type D1ColumnInfo = {
	name: string;
};

export interface AuthenticatedUser {
	userId: string;
	username: string;
	tokenType: 'session' | 'api_key';
}

export interface BookmarkImagePayload {
	contentType?: string;
	dataBase64?: string;
	height?: number;
	sourceCandidates?: string[];
	sourceUrl?: string;
	variant?: string;
	width?: number;
}

export interface BookmarkPayload {
	canonicalUrl?: string;
	htmlData?: string;
	images?: BookmarkImagePayload[];
	isRead?: boolean;
	lang?: string;
	listId?: string | null;
	markdownData?: string;
	pinned?: boolean;
	siteName?: string;
	sortOrder?: number;
	status?: string;
	tags?: string[];
	textContent?: string;
	title?: string;
	url?: string;
}

export interface BookmarkListItem {
	id: string;
	name: string;
	metadata: Record<string, unknown>;
}

export interface BookmarkRecord {
	htmlData?: string;
	id: string;
	markdownData: string;
	metadata: Record<string, unknown>;
	name: string;
}

export interface StoredChallenge {
	challenge: string;
	type: 'registration' | 'authentication';
	userId?: string;
	username: string;
}

export interface StoredCredential {
	backedUp: boolean;
	counter: number;
	credentialId: string;
	deviceType: string | null;
	publicKey: Uint8Array;
	transports?: string[];
}

export interface ListPayload {
	name: string;
	sortOrder?: number;
}

export interface SmartListPayload {
	icon?: string;
	name: string;
	rules: string;
	sortOrder?: number;
}

export interface BookmarkPatchPayload {
	isRead?: boolean;
	listId?: string | null;
	pinned?: boolean;
	sortOrder?: number;
	tags?: string[];
}

export function bufferToBase64URL(buffer: ArrayBuffer | Uint8Array): string {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64URLToUint8Array(value: string): Uint8Array {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

export function base64ToUint8Array(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function stripTrackingParams(searchParams: URLSearchParams): URLSearchParams {
	const entries = [...searchParams.entries()].filter(([key]) => !key.toLowerCase().startsWith('utm_') && !TRACKING_QUERY_KEYS.has(key.toLowerCase()));
	entries.sort((left, right) => {
		if (left[0] === right[0]) {
			return left[1].localeCompare(right[1]);
		}
		return left[0].localeCompare(right[0]);
	});

	const nextParams = new URLSearchParams();
	for (const [key, value] of entries) {
		nextParams.append(key, value);
	}
	return nextParams;
}

export function normalizeCanonicalUrl(rawUrl: string): string {
	const parsedUrl = new URL(rawUrl);
	parsedUrl.hash = '';
	parsedUrl.protocol = parsedUrl.protocol.toLowerCase();
	parsedUrl.hostname = parsedUrl.hostname.toLowerCase();

	if ((parsedUrl.protocol === 'https:' && parsedUrl.port === '443') || (parsedUrl.protocol === 'http:' && parsedUrl.port === '80')) {
		parsedUrl.port = '';
	}

	parsedUrl.pathname = parsedUrl.pathname.replace(/\/{2,}/g, '/');
	if (!parsedUrl.pathname) {
		parsedUrl.pathname = '/';
	}
	if (parsedUrl.pathname.length > 1 && parsedUrl.pathname.endsWith('/')) {
		parsedUrl.pathname = parsedUrl.pathname.slice(0, -1);
	}

	const nextSearchParams = stripTrackingParams(parsedUrl.searchParams);
	const search = nextSearchParams.toString();
	parsedUrl.search = search ? `?${search}` : '';

	return parsedUrl.toString();
}

export function parseStringArray(value: string | null): string[] {
	if (!value) {
		return [];
	}

	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter((entry): entry is string => typeof entry === 'string');
	} catch {
		return [];
	}
}

export function compactObject<T extends Record<string, unknown>>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== '')) as T;
}

export function hexFromBytes(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string | ArrayBuffer | ArrayBufferView): Promise<string> {
	const input = typeof value === 'string'
		? encoder.encode(value)
		: value instanceof ArrayBuffer
			? new Uint8Array(value)
			: new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	const digest = await crypto.subtle.digest('SHA-256', input);
	return hexFromBytes(new Uint8Array(digest));
}

export async function hashToken(token: string): Promise<string> {
	return sha256Hex(token);
}

export async function getTableColumnNames(env: StorageEnv, tableName: string): Promise<Set<string>> {
	const result = await env.KEEPROOT_DB.prepare(`PRAGMA table_info(${tableName})`).all<D1ColumnInfo>();
	return new Set(result.results.map((column) => column.name));
}

export async function runSchemaStatement(env: StorageEnv, sql: string): Promise<void> {
	try {
		await env.KEEPROOT_DB.exec(sql.replace(/\s+/g, ' ').trim());
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/duplicate column name|already exists/i.test(message)) {
			return;
		}
		throw error;
	}
}
