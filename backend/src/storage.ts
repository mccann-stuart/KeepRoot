const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const TRACKING_QUERY_KEYS = new Set([
	'fbclid',
	'gclid',
	'mc_cid',
	'mc_eid',
	'ref',
	'ref_src',
	'src',
]);
const MAX_AUTO_FETCH_IMAGES = 12;

const encoder = new TextEncoder();

export interface StorageEnv {
	KEEPROOT_DB: D1Database;
	KEEPROOT_CONTENT: R2Bucket;
}

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
	lang?: string;
	markdownData?: string;
	siteName?: string;
	status?: string;
	tags?: string[];
	textContent?: string;
	title?: string;
	url?: string;
}

export interface BookmarkListItem {
	name: string;
	metadata: Record<string, unknown>;
}

export interface BookmarkRecord {
	htmlData?: string;
	id: string;
	markdownData: string;
	metadata: Record<string, unknown>;
}

interface UserRow {
	created_at: string;
	id: string;
	username: string;
}

interface CredentialRow {
	backed_up: number;
	counter: number;
	created_at: string;
	credential_id: string;
	device_type: string | null;
	public_key: string;
	transports: string | null;
	user_id: string;
}

interface ChallengeRow {
	challenge: string;
	expires_at: string;
	id: string;
	type: string;
	user_id: string | null;
	username: string;
}

interface ApiKeyRow {
	created_at: string;
	id: string;
	name: string;
	user_id: string;
	username: string;
}

interface BookmarkRow {
	canonical_url: string;
	content_hash: string | null;
	content_length: number | null;
	content_ref: string | null;
	content_type: string | null;
	created_at: string;
	domain: string | null;
	excerpt: string | null;
	id: string;
	lang: string | null;
	last_fetched_at: string | null;
	site_name: string | null;
	status: string;
	title: string;
	updated_at: string;
	url: string;
	word_count: number | null;
}

interface BookmarkContentRow {
	content_hash: string;
	content_length: number | null;
	content_type: string | null;
	excerpt: string | null;
	fetched_at: string;
	html_r2_key: string | null;
	lang: string | null;
	r2_key: string;
	word_count: number | null;
}

interface BookmarkImageRow {
	created_at: string;
	height: number | null;
	image_hash: string;
	r2_key: string;
	type: string | null;
	width: number | null;
}

interface StoredContentDocument {
	contentHash: string;
	htmlKey: string | null;
	images: Array<{ height: number | null; imageHash: string; key: string; type: string | null; variant: string | null; width: number | null }>;
	lang: string | null;
	markdownData: string;
	textContent: string;
	version: 1;
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

function base64ToUint8Array(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function normalizeStatus(value?: string): string {
	const normalized = (value ?? 'saved').trim().toLowerCase();
	return normalized || 'saved';
}

function normalizeTagName(value: string): string {
	return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeVariant(value?: string): string {
	return (value ?? 'original').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function trimWrappingDelimiters(value: string): string {
	let normalized = value.trim();
	if (normalized.startsWith('<') && normalized.endsWith('>')) {
		normalized = normalized.slice(1, -1).trim();
	}
	return normalized;
}

interface ParsedMarkdownImageTarget {
	sourceUrl: string;
	suffix: string;
	wrappedInAngleBrackets: boolean;
}

function parseMarkdownImageTarget(rawTarget: string): ParsedMarkdownImageTarget | null {
	const trimmedTarget = rawTarget.trim();
	if (!trimmedTarget) {
		return null;
	}

	if (trimmedTarget.startsWith('<')) {
		const closingBracketIndex = trimmedTarget.indexOf('>');
		if (closingBracketIndex > 0) {
			const sourceUrl = trimWrappingDelimiters(trimmedTarget.slice(0, closingBracketIndex + 1));
			if (!sourceUrl) {
				return null;
			}
			return {
				sourceUrl,
				suffix: trimmedTarget.slice(closingBracketIndex + 1),
				wrappedInAngleBrackets: true,
			};
		}
	}

	const match = /^(?<source>\S+)(?<suffix>\s+["'][\s\S]*["'])?$/.exec(trimmedTarget);
	const sourceUrl = trimWrappingDelimiters(match?.groups?.source ?? trimmedTarget);
	if (!sourceUrl) {
		return null;
	}

	return {
		sourceUrl,
		suffix: match?.groups?.suffix ?? '',
		wrappedInAngleBrackets: false,
	};
}

function extractMarkdownImageUrls(markdown: string): string[] {
	const imageUrls: string[] = [];
	const markdownImagePattern = /!\[[^\]]*]\(([^)\n]+)\)/g;
	let match: RegExpExecArray | null = markdownImagePattern.exec(markdown);

	while (match) {
		const parsedTarget = parseMarkdownImageTarget(match[1] ?? '');
		if (parsedTarget?.sourceUrl) {
			imageUrls.push(parsedTarget.sourceUrl);
		}

		match = markdownImagePattern.exec(markdown);
	}

	return imageUrls;
}

function extractHtmlImageUrls(html: string): string[] {
	const imageUrls: string[] = [];
	const htmlImagePattern = /<img\b[^>]*\bsrc=(["'])([^"']+)\1/gi;
	let match: RegExpExecArray | null = htmlImagePattern.exec(html);

	while (match) {
		const target = trimWrappingDelimiters(match[2] ?? '');
		if (target) {
			imageUrls.push(target);
		}
		match = htmlImagePattern.exec(html);
	}

	return imageUrls;
}

function resolveAbsoluteImageUrl(imageUrl: string, pageUrl: string): string | null {
	try {
		return new URL(imageUrl, pageUrl).toString();
	} catch {
		return null;
	}
}

function buildRootRelativeImageUrl(absoluteUrl: string, pageUrl: string): string | null {
	try {
		const absolute = new URL(absoluteUrl);
		const page = new URL(pageUrl);
		if (absolute.origin !== page.origin) {
			return null;
		}
		return `${absolute.pathname}${absolute.search}${absolute.hash}`;
	} catch {
		return null;
	}
}

function buildPageRelativeImageUrl(absoluteUrl: string, pageUrl: string): string | null {
	try {
		const absolute = new URL(absoluteUrl);
		const page = new URL(pageUrl);
		if (absolute.origin !== page.origin) {
			return null;
		}

		const fromSegments = page.pathname.split('/').filter(Boolean);
		if (!page.pathname.endsWith('/')) {
			fromSegments.pop();
		}

		const toSegments = absolute.pathname.split('/').filter(Boolean);
		let commonPrefixLength = 0;
		while (
			commonPrefixLength < fromSegments.length &&
			commonPrefixLength < toSegments.length &&
			fromSegments[commonPrefixLength] === toSegments[commonPrefixLength]
		) {
			commonPrefixLength += 1;
		}

		const upwardSegments = new Array(fromSegments.length - commonPrefixLength).fill('..');
		const downwardSegments = toSegments.slice(commonPrefixLength);
		let relativePath = [...upwardSegments, ...downwardSegments].join('/');
		if (!relativePath) {
			relativePath = '.';
		}
		if (absolute.pathname.endsWith('/') && !relativePath.endsWith('/')) {
			relativePath += '/';
		}
		return `${relativePath}${absolute.search}${absolute.hash}`;
	} catch {
		return null;
	}
}

function buildProtocolRelativeImageUrl(absoluteUrl: string): string | null {
	try {
		const absolute = new URL(absoluteUrl);
		if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') {
			return null;
		}
		return `//${absolute.host}${absolute.pathname}${absolute.search}${absolute.hash}`;
	} catch {
		return null;
	}
}

function buildImageSourceCandidates(sourceUrl: string, pageUrl: string, absoluteUrl?: string | null): string[] {
	const candidates = new Set<string>();
	const trimmedSourceUrl = trimWrappingDelimiters(sourceUrl);
	if (trimmedSourceUrl) {
		candidates.add(trimmedSourceUrl);
	}

	const resolvedAbsoluteUrl = absoluteUrl ?? resolveAbsoluteImageUrl(trimmedSourceUrl, pageUrl);
	if (!resolvedAbsoluteUrl) {
		return [...candidates];
	}

	candidates.add(resolvedAbsoluteUrl);

	const protocolRelativeUrl = buildProtocolRelativeImageUrl(resolvedAbsoluteUrl);
	if (protocolRelativeUrl) {
		candidates.add(protocolRelativeUrl);
	}

	const rootRelativeUrl = buildRootRelativeImageUrl(resolvedAbsoluteUrl, pageUrl);
	if (rootRelativeUrl) {
		candidates.add(rootRelativeUrl);
	}

	const pageRelativeUrl = buildPageRelativeImageUrl(resolvedAbsoluteUrl, pageUrl);
	if (pageRelativeUrl) {
		candidates.add(pageRelativeUrl);
		if (!pageRelativeUrl.startsWith('.') && !pageRelativeUrl.startsWith('/')) {
			candidates.add(`./${pageRelativeUrl}`);
		}
	}

	return [...candidates];
}

function rewriteMarkdownImageUrls(markdown: string, rewriteMap: Map<string, string>): string {
	return markdown.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (fullMatch, altText: string, rawTarget: string) => {
		const parsedTarget = parseMarkdownImageTarget(rawTarget);
		if (!parsedTarget) {
			return fullMatch;
		}

		const rewrittenUrl = rewriteMap.get(parsedTarget.sourceUrl);
		if (!rewrittenUrl) {
			return fullMatch;
		}

		const targetUrl = parsedTarget.wrappedInAngleBrackets ? `<${rewrittenUrl}>` : rewrittenUrl;
		return `![${altText}](${targetUrl}${parsedTarget.suffix})`;
	});
}

function rewriteHtmlImageUrls(html: string, rewriteMap: Map<string, string>): string {
	return html.replace(/(<img\b[^>]*\bsrc=(["']))([^"']+)(\2[^>]*>)/gi, (fullMatch, prefix: string, _quote: string, sourceUrl: string, suffix: string) => {
		const rewrittenUrl = rewriteMap.get(trimWrappingDelimiters(sourceUrl));
		if (!rewrittenUrl) {
			return fullMatch;
		}

		return `${prefix}${rewrittenUrl}${suffix}`;
	});
}

function base64FromBytes(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function parseDataUrl(dataUrl: string): BookmarkImagePayload | null {
	const dataUrlMatch = /^data:([^;,]+)?(?:;charset=[^;,]+)?(?:;(base64))?,(.*)$/i.exec(dataUrl);
	if (!dataUrlMatch) {
		return null;
	}

	const contentType = dataUrlMatch[1] || 'application/octet-stream';
	const isBase64 = Boolean(dataUrlMatch[2]);
	const dataPart = dataUrlMatch[3] ?? '';
	const decoded = decodeURIComponent(dataPart);

	if (isBase64) {
		return {
			contentType,
			dataBase64: decoded,
			sourceUrl: dataUrl,
		};
	}

	return {
		contentType,
		dataBase64: btoa(decoded),
		sourceUrl: dataUrl,
	};
}

async function fetchImageAsPayload(imageUrl: string, pageUrl: string): Promise<BookmarkImagePayload | null> {
	const absoluteUrl = resolveAbsoluteImageUrl(imageUrl, pageUrl);
	if (!absoluteUrl) {
		return null;
	}

	if (absoluteUrl.startsWith('data:')) {
		return parseDataUrl(absoluteUrl);
	}

	const response = await fetch(absoluteUrl);
	if (!response.ok) {
		return null;
	}

	const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
	if (!contentType.toLowerCase().startsWith('image/')) {
		return null;
	}

	const buffer = await response.arrayBuffer();
	return {
		contentType,
		dataBase64: base64FromBytes(new Uint8Array(buffer)),
		sourceUrl: absoluteUrl,
	};
}

async function hydrateImagePayloads(payload: BookmarkPayload, pageUrl: string): Promise<BookmarkImagePayload[]> {
	const hydratedImages = [...(payload.images ?? [])];
	const discoveredImageUrls = [
		...extractMarkdownImageUrls(payload.markdownData ?? ''),
		...extractHtmlImageUrls(payload.htmlData ?? ''),
	];

	const existingSourceUrls = new Set<string>();
	for (const image of hydratedImages) {
		if (!image.sourceUrl) {
			continue;
		}
		for (const candidate of buildImageSourceCandidates(image.sourceUrl, pageUrl)) {
			existingSourceUrls.add(candidate);
		}
	}
	const uniqueDiscoveredUrls = [...new Set(discoveredImageUrls)];

	for (const imageUrl of uniqueDiscoveredUrls.slice(0, MAX_AUTO_FETCH_IMAGES)) {
		const absoluteImageUrl = resolveAbsoluteImageUrl(imageUrl, pageUrl);
		if (!absoluteImageUrl || existingSourceUrls.has(absoluteImageUrl)) {
			continue;
		}

		try {
			const fetchedImage = await fetchImageAsPayload(absoluteImageUrl, pageUrl);
			if (!fetchedImage?.dataBase64) {
				continue;
			}
			const sourceCandidates = buildImageSourceCandidates(imageUrl, pageUrl, absoluteImageUrl);
			hydratedImages.push({
				...fetchedImage,
				sourceCandidates,
			});
			for (const candidate of sourceCandidates) {
				existingSourceUrls.add(candidate);
			}
		} catch {
			// Best-effort image ingestion; bookmark save should still succeed.
		}
	}

	return hydratedImages;
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

function domainFromUrl(url: string): string | null {
	try {
		return new URL(url).hostname;
	} catch {
		return null;
	}
}

function markdownToPlainText(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/^>\s+/gm, '')
		.replace(/[*_~>-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function buildExcerpt(content: string): string {
	if (content.length <= 240) {
		return content;
	}
	return `${content.slice(0, 237).trimEnd()}...`;
}

function countWords(content: string): number {
	if (!content) {
		return 0;
	}
	return content.split(/\s+/).filter(Boolean).length;
}

function hexFromBytes(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string | ArrayBuffer | ArrayBufferView): Promise<string> {
	const input = typeof value === 'string'
		? encoder.encode(value)
		: value instanceof ArrayBuffer
			? new Uint8Array(value)
			: new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	const digest = await crypto.subtle.digest('SHA-256', input);
	return hexFromBytes(new Uint8Array(digest));
}

function parseStringArray(value: string | null): string[] {
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

function compactObject<T extends Record<string, unknown>>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== '')) as T;
}

async function putIfMissing(bucket: R2Bucket, key: string, value: string | ArrayBuffer | ArrayBufferView, contentType: string): Promise<void> {
	const existingObject = await bucket.head(key);
	if (existingObject) {
		return;
	}

	await bucket.put(key, value, {
		httpMetadata: { contentType },
	});
}

function makeBookmarkMetadata(row: BookmarkRow, tags: string[], images: BookmarkImageRow[]): Record<string, unknown> {
	return compactObject({
		canonicalUrl: row.canonical_url,
		contentHash: row.content_hash,
		contentLength: row.content_length,
		contentRef: row.content_ref,
		contentType: row.content_type,
		createdAt: row.created_at,
		domain: row.domain,
		excerpt: row.excerpt,
		imageCount: images.length,
		lang: row.lang,
		lastFetchedAt: row.last_fetched_at,
		siteName: row.site_name,
		status: row.status,
		tags,
		title: row.title,
		updatedAt: row.updated_at,
		url: row.url,
		wordCount: row.word_count,
	});
}

async function getBookmarkImages(env: StorageEnv, bookmarkId: string): Promise<BookmarkImageRow[]> {
	const result = await env.KEEPROOT_DB.prepare(
		`SELECT image_hash, r2_key, width, height, type, created_at
		FROM bookmark_images
		WHERE bookmark_id = ?
		ORDER BY created_at ASC`,
	)
		.bind(bookmarkId)
		.all<BookmarkImageRow>();

	return result.results;
}

async function getBookmarkTags(env: StorageEnv, bookmarkId: string): Promise<string[]> {
	const result = await env.KEEPROOT_DB.prepare(
		`SELECT tags.name
		FROM tags
		INNER JOIN bookmark_tags ON bookmark_tags.tag_id = tags.id
		WHERE bookmark_tags.bookmark_id = ?
		ORDER BY tags.name ASC`,
	)
		.bind(bookmarkId)
		.all<{ name: string }>();

	return result.results.map((row) => row.name);
}

async function syncTags(env: StorageEnv, userId: string, bookmarkId: string, tags: string[], createdAt: string): Promise<void> {
	const rawTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
	if (rawTags.length === 0) {
		await env.KEEPROOT_DB.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ?').bind(bookmarkId).run();
		return;
	}

	const batchStatements = [
		env.KEEPROOT_DB.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ?').bind(bookmarkId),
	];

	// Deduplicate tags by their normalized name to avoid duplicate INSERTS in the batch
	const normalizedTagsMap = new Map<string, string>();
	for (const rawTag of rawTags) {
		const normalized = normalizeTagName(rawTag);
		if (!normalizedTagsMap.has(normalized)) {
			normalizedTagsMap.set(normalized, rawTag);
		}
	}

	const normalizedTags: { normalized: string; name: string }[] = [];
	for (const [normalized, name] of normalizedTagsMap.entries()) {
		normalizedTags.push({ normalized, name });
	}

	const placeholders = normalizedTags.map(() => '?').join(', ');

	// Pre-fetch all existing tags in a single query
	const existingTags = await env.KEEPROOT_DB.prepare(
		`SELECT id, normalized_name FROM tags WHERE user_id = ? AND normalized_name IN (${placeholders})`
	)
		.bind(userId, ...normalizedTags.map(t => t.normalized))
		.all<{ id: string; normalized_name: string }>();

	const existingTagsMap = new Map<string, string>();
	for (const row of existingTags.results) {
		existingTagsMap.set(row.normalized_name, row.id);
	}

	for (const tag of normalizedTags) {
		let tagId = existingTagsMap.get(tag.normalized);

		if (!tagId) {
			tagId = crypto.randomUUID();
			batchStatements.push(
				env.KEEPROOT_DB.prepare(
					'INSERT INTO tags (id, user_id, name, normalized_name, created_at) VALUES (?, ?, ?, ?, ?)',
				).bind(tagId, userId, tag.name, tag.normalized, createdAt)
			);
			// We don't need to add it to existingTagsMap here because we've already
			// deduplicated the incoming tags by normalized name.
		}

		batchStatements.push(
			env.KEEPROOT_DB.prepare(
				'INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)',
			).bind(bookmarkId, tagId)
		);
	}

	await env.KEEPROOT_DB.batch(batchStatements);
}

async function syncImages(env: StorageEnv, bookmarkId: string, images: BookmarkImagePayload[], createdAt: string): Promise<void> {
	await env.KEEPROOT_DB.prepare('DELETE FROM bookmark_images WHERE bookmark_id = ?').bind(bookmarkId).run();

	for (const image of images) {
		if (!image.dataBase64) {
			continue;
		}

		const bytes = base64ToUint8Array(image.dataBase64);
		const imageHash = await sha256Hex(bytes);
		const variant = normalizeVariant(image.variant);
		const key = variant === 'original' ? `images/${imageHash}` : `thumbs/${imageHash}/${variant}`;
		await putIfMissing(env.KEEPROOT_CONTENT, key, bytes, image.contentType ?? 'application/octet-stream');

		await env.KEEPROOT_DB.prepare(
			`INSERT OR REPLACE INTO bookmark_images (bookmark_id, image_hash, r2_key, width, height, type, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(bookmarkId, imageHash, key, image.width ?? null, image.height ?? null, image.contentType ?? null, createdAt)
			.run();
	}
}

async function getContentDocument(env: StorageEnv, contentRow: BookmarkContentRow | null): Promise<StoredContentDocument | null> {
	if (!contentRow) {
		return null;
	}

	const objectBody = await env.KEEPROOT_CONTENT.get(contentRow.r2_key);
	if (!objectBody) {
		return null;
	}

	return objectBody.json<StoredContentDocument>();
}

export async function hashToken(token: string): Promise<string> {
	return sha256Hex(token);
}

export async function getUserByUsername(env: StorageEnv, username: string): Promise<UserRow | null> {
	return env.KEEPROOT_DB.prepare(
		'SELECT id, username, created_at FROM users WHERE username = ?',
	)
		.bind(username)
		.first<UserRow>();
}

export async function getUserCredentials(env: StorageEnv, username: string): Promise<StoredCredential[]> {
	const rows = await env.KEEPROOT_DB.prepare(
		`SELECT webauthn_credentials.credential_id, webauthn_credentials.public_key, webauthn_credentials.counter,
			webauthn_credentials.transports, webauthn_credentials.device_type, webauthn_credentials.backed_up
		FROM webauthn_credentials
		INNER JOIN users ON users.id = webauthn_credentials.user_id
		WHERE users.username = ?
		ORDER BY webauthn_credentials.created_at ASC`,
	)
		.bind(username)
		.all<CredentialRow>();

	return rows.results.map((row) => ({
		backedUp: Boolean(row.backed_up),
		counter: row.counter,
		credentialId: row.credential_id,
		deviceType: row.device_type,
		publicKey: base64URLToUint8Array(row.public_key),
		transports: parseStringArray(row.transports),
	}));
}

export async function storeAuthChallenge(env: StorageEnv, challenge: StoredChallenge): Promise<void> {
	const now = new Date();
	const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
	await env.KEEPROOT_DB.prepare(
		'DELETE FROM auth_challenges WHERE username = ? AND type = ?',
	)
		.bind(challenge.username, challenge.type)
		.run();

	await env.KEEPROOT_DB.prepare(
		`INSERT INTO auth_challenges (id, username, user_id, challenge, type, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			crypto.randomUUID(),
			challenge.username,
			challenge.userId ?? null,
			challenge.challenge,
			challenge.type,
			now.toISOString(),
			expiresAt,
		)
		.run();
}

export async function getValidAuthChallenge(
	env: StorageEnv,
	username: string,
	type: StoredChallenge['type'],
): Promise<ChallengeRow | null> {
	const now = new Date().toISOString();
	return env.KEEPROOT_DB.prepare(
		`SELECT id, username, user_id, challenge, type, expires_at
		FROM auth_challenges
		WHERE username = ? AND type = ? AND expires_at > ?
		ORDER BY created_at DESC
		LIMIT 1`,
	)
		.bind(username, type, now)
		.first<ChallengeRow>();
}

export async function deleteAuthChallenge(env: StorageEnv, username: string, type: StoredChallenge['type']): Promise<void> {
	await env.KEEPROOT_DB.prepare(
		'DELETE FROM auth_challenges WHERE username = ? AND type = ?',
	)
		.bind(username, type)
		.run();
}

export async function createUserWithCredential(
	env: StorageEnv,
	username: string,
	userId: string,
	credential: {
		backedUp: boolean;
		counter: number;
		credentialId: string;
		deviceType: string | null;
		publicKey: Uint8Array;
		transports?: string[];
	},
): Promise<void> {
	const createdAt = new Date().toISOString();
	await env.KEEPROOT_DB.prepare(
		'INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)',
	)
		.bind(userId, username, createdAt)
		.run();

	await env.KEEPROOT_DB.prepare(
		`INSERT INTO webauthn_credentials
		(credential_id, user_id, public_key, counter, transports, device_type, backed_up, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			credential.credentialId,
			userId,
			bufferToBase64URL(credential.publicKey),
			credential.counter,
			credential.transports?.length ? JSON.stringify(credential.transports) : null,
			credential.deviceType,
			credential.backedUp ? 1 : 0,
			createdAt,
		)
		.run();
}

export async function updateCredentialCounter(
	env: StorageEnv,
	username: string,
	credentialId: string,
	counter: number,
): Promise<void> {
	await env.KEEPROOT_DB.prepare(
		`UPDATE webauthn_credentials
		SET counter = ?
		WHERE credential_id = ?
			AND user_id = (SELECT id FROM users WHERE username = ?)`,
	)
		.bind(counter, credentialId, username)
		.run();
}

export async function createSession(
	env: StorageEnv,
	user: Pick<AuthenticatedUser, 'userId' | 'username'>,
): Promise<string> {
	const rawToken = crypto.randomUUID();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
	await env.KEEPROOT_DB.prepare(
		`INSERT INTO sessions (id, token_hash, user_id, username, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			crypto.randomUUID(),
			await hashToken(rawToken),
			user.userId,
			user.username,
			now.toISOString(),
			expiresAt,
		)
		.run();

	return rawToken;
}

export async function authenticateBearerToken(env: StorageEnv, token: string): Promise<AuthenticatedUser | null> {
	const tokenHash = await hashToken(token);
	const now = new Date().toISOString();
	const session = await env.KEEPROOT_DB.prepare(
		`SELECT user_id, username
		FROM sessions
		WHERE token_hash = ? AND expires_at > ?
		LIMIT 1`,
	)
		.bind(tokenHash, now)
		.first<{ user_id: string; username: string }>();

	if (session) {
		return {
			tokenType: 'session',
			userId: session.user_id,
			username: session.username,
		};
	}

	const apiKey = await env.KEEPROOT_DB.prepare(
		`SELECT id, user_id, username
		FROM api_keys
		WHERE secret_hash = ?
		LIMIT 1`,
	)
		.bind(tokenHash)
		.first<{ id: string; user_id: string; username: string }>();

	if (!apiKey) {
		return null;
	}

	await env.KEEPROOT_DB.prepare(
		'UPDATE api_keys SET last_used_at = ? WHERE id = ?',
	)
		.bind(now, apiKey.id)
		.run();

	return {
		tokenType: 'api_key',
		userId: apiKey.user_id,
		username: apiKey.username,
	};
}

export async function listApiKeys(env: StorageEnv, userId: string): Promise<Array<{ createdAt: string; id: string; name: string }>> {
	const result = await env.KEEPROOT_DB.prepare(
		`SELECT id, name, created_at
		FROM api_keys
		WHERE user_id = ?
		ORDER BY created_at DESC`,
	)
		.bind(userId)
		.all<ApiKeyRow>();

	return result.results.map((row) => ({
		createdAt: row.created_at,
		id: row.id,
		name: row.name,
	}));
}

export async function createApiKey(
	env: StorageEnv,
	user: Pick<AuthenticatedUser, 'userId' | 'username'>,
	name: string,
): Promise<{ metadata: { createdAt: string; id: string; name: string; userId: string; username: string }; secret: string }> {
	const secretBytes = new Uint8Array(24);
	crypto.getRandomValues(secretBytes);
	const secret = hexFromBytes(secretBytes);
	const createdAt = new Date().toISOString();
	const keyId = crypto.randomUUID();
	const metadata = {
		createdAt,
		id: keyId,
		name,
		userId: user.userId,
		username: user.username,
	};

	await env.KEEPROOT_DB.prepare(
		`INSERT INTO api_keys (id, secret_hash, user_id, username, name, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(keyId, await hashToken(secret), user.userId, user.username, name, createdAt)
		.run();

	return { metadata, secret };
}

export async function deleteApiKey(env: StorageEnv, userId: string, keyId: string): Promise<boolean> {
	const result = await env.KEEPROOT_DB.prepare(
		'DELETE FROM api_keys WHERE id = ? AND user_id = ?',
	)
		.bind(keyId, userId)
		.run();

	return Boolean(result.meta.changes);
}

export async function saveBookmark(
	env: StorageEnv,
	user: Pick<AuthenticatedUser, 'userId' | 'username'>,
	payload: BookmarkPayload,
): Promise<{ id: string; metadata: Record<string, unknown> }> {
	if (!payload.url) {
		throw new Error('Missing url');
	}

	const rawContent = payload.markdownData ?? payload.textContent ?? payload.htmlData;
	if (!rawContent) {
		throw new Error('Missing bookmark content');
	}

	const normalizedUrl = normalizeCanonicalUrl(payload.url);
	const canonicalUrl = normalizeCanonicalUrl(payload.canonicalUrl ?? payload.url);
	const plainText = payload.textContent?.trim() || markdownToPlainText(payload.markdownData ?? rawContent);
	const markdownData = payload.markdownData?.trim() || plainText;
	const excerpt = buildExcerpt(plainText);
	const wordCount = countWords(plainText);
	const now = new Date().toISOString();
	const title = payload.title?.trim() || 'Untitled';
	const domain = domainFromUrl(canonicalUrl);
	const status = normalizeStatus(payload.status);
	const siteName = payload.siteName?.trim() || domain;
	const hydratedImages = await hydrateImagePayloads(payload, normalizedUrl);

	let rewrittenMarkdownData = markdownData;
	let rewrittenHtmlData = payload.htmlData;

	const contentDocument: StoredContentDocument = {
		contentHash: '',
		htmlKey: null, // Set below
		images: [],
		lang: payload.lang ?? null,
		markdownData: '', // Set below
		textContent: plainText,
		version: 1,
	};

	if (hydratedImages.length) {
		for (const image of hydratedImages) {
			if (!image.dataBase64) {
				continue;
			}
			const bytes = base64ToUint8Array(image.dataBase64);
			const imageHash = await sha256Hex(bytes);
			const variant = normalizeVariant(image.variant);
			const imageKey = variant === 'original' ? `images/${imageHash}` : `thumbs/${imageHash}/${variant}`;
			contentDocument.images.push({
				height: image.height ?? null,
				imageHash,
				key: imageKey,
				type: image.contentType ?? null,
				variant: image.variant ?? null,
				width: image.width ?? null,
			});

			const sourceCandidates = image.sourceCandidates?.length
				? image.sourceCandidates
				: image.sourceUrl
					? buildImageSourceCandidates(image.sourceUrl, normalizedUrl)
					: [];

			if (sourceCandidates.length) {
				const rewrittenImagePath = `/${imageKey}`;
				const rewriteMap = new Map(sourceCandidates.map((candidate) => [candidate, rewrittenImagePath]));
				rewrittenMarkdownData = rewriteMarkdownImageUrls(rewrittenMarkdownData, rewriteMap);
				if (rewrittenHtmlData) {
					rewrittenHtmlData = rewriteHtmlImageUrls(rewrittenHtmlData, rewriteMap);
				}
			}
		}
	}

	let htmlKey: string | null = null;
	if (rewrittenHtmlData?.trim()) {
		const htmlData = rewrittenHtmlData.trim();
		const htmlHash = await sha256Hex(htmlData);
		htmlKey = `html/${htmlHash}.html`;
		await putIfMissing(env.KEEPROOT_CONTENT, htmlKey, htmlData, 'text/html;charset=UTF-8');
	}

	contentDocument.htmlKey = htmlKey;
	contentDocument.markdownData = rewrittenMarkdownData;

	const contentJsonWithoutHash = JSON.stringify(contentDocument);
	const contentHash = await sha256Hex(contentJsonWithoutHash);
	contentDocument.contentHash = contentHash;
	const contentJson = JSON.stringify(contentDocument);
	const contentKey = `content/${contentHash}.json`;
	const contentLength = encoder.encode(contentJson).byteLength;
	await putIfMissing(env.KEEPROOT_CONTENT, contentKey, contentJson, 'application/json');

	const urlHash = await sha256Hex(canonicalUrl);
	const existingBookmark = await env.KEEPROOT_DB.prepare(
		`SELECT id, created_at
		FROM bookmarks
		WHERE user_id = ? AND url_hash = ?
		LIMIT 1`,
	)
		.bind(user.userId, urlHash)
		.first<{ created_at: string; id: string }>();

	const bookmarkId = existingBookmark?.id ?? crypto.randomUUID();
	const createdAt = existingBookmark?.created_at ?? now;

	if (existingBookmark) {
		await env.KEEPROOT_DB.prepare(
			`UPDATE bookmarks
			SET url = ?, canonical_url = ?, url_hash = ?, title = ?, site_name = ?, domain = ?, status = ?,
				updated_at = ?, last_fetched_at = ?, content_hash = ?, content_ref = ?, content_type = ?,
				content_length = ?, excerpt = ?, word_count = ?, lang = ?
			WHERE id = ? AND user_id = ?`,
		)
			.bind(
				normalizedUrl,
				canonicalUrl,
				urlHash,
				title,
				siteName,
				domain,
				status,
				now,
				now,
				contentHash,
				contentKey,
				'application/json',
				contentLength,
				excerpt,
				wordCount,
				payload.lang ?? null,
				bookmarkId,
				user.userId,
			)
			.run();
	} else {
		await env.KEEPROOT_DB.prepare(
			`INSERT INTO bookmarks
			(id, user_id, url, canonical_url, url_hash, title, site_name, domain, status, created_at, updated_at, last_fetched_at, content_hash, content_ref, content_type, content_length, excerpt, word_count, lang)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				bookmarkId,
				user.userId,
				normalizedUrl,
				canonicalUrl,
				urlHash,
				title,
				siteName,
				domain,
				status,
				createdAt,
				now,
				now,
				contentHash,
				contentKey,
				'application/json',
				contentLength,
				excerpt,
				wordCount,
				payload.lang ?? null,
			)
			.run();
	}

	await env.KEEPROOT_DB.prepare(
		`INSERT OR REPLACE INTO bookmark_contents
		(bookmark_id, content_hash, r2_key, html_r2_key, excerpt, word_count, lang, content_type, content_length, fetched_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			bookmarkId,
			contentHash,
			contentKey,
			htmlKey,
			excerpt,
			wordCount,
			payload.lang ?? null,
			'application/json',
			contentLength,
			now,
		)
		.run();

	if (payload.tags) {
		await syncTags(env, user.userId, bookmarkId, payload.tags, now);
	}

	if (hydratedImages.length) {
		await syncImages(env, bookmarkId, hydratedImages, now);
	}

	return {
		id: bookmarkId,
		metadata: compactObject({
			contentHash,
			contentLength,
			contentRef: contentKey,
			contentType: 'application/json',
			createdAt,
			domain,
			excerpt,
			lang: payload.lang ?? null,
			lastFetchedAt: now,
			siteName,
			status,
			title,
			updatedAt: now,
			url: normalizedUrl,
			wordCount,
		}),
	};
}

export async function listBookmarks(env: StorageEnv, userId: string): Promise<BookmarkListItem[]> {
	const bookmarks = await env.KEEPROOT_DB.prepare(
		`SELECT id, url, canonical_url, title, site_name, domain, status, created_at, updated_at, last_fetched_at,
			content_hash, content_ref, content_type, content_length, excerpt, word_count, lang
		FROM bookmarks
		WHERE user_id = ?
		ORDER BY created_at DESC`,
	)
		.bind(userId)
		.all<BookmarkRow>();

	return bookmarks.results.map((row) => ({
		name: row.id,
		metadata: makeBookmarkMetadata(row, [], []),
	}));
}

export async function getBookmark(env: StorageEnv, userId: string, bookmarkId: string): Promise<BookmarkRecord | null> {
	const bookmarkRow = await env.KEEPROOT_DB.prepare(
		`SELECT id, url, canonical_url, title, site_name, domain, status, created_at, updated_at, last_fetched_at,
			content_hash, content_ref, content_type, content_length, excerpt, word_count, lang
		FROM bookmarks
		WHERE id = ? AND user_id = ?
		LIMIT 1`,
	)
		.bind(bookmarkId, userId)
		.first<BookmarkRow>();

	if (!bookmarkRow) {
		return null;
	}

	const contentRow = await env.KEEPROOT_DB.prepare(
		`SELECT content_hash, r2_key, html_r2_key, excerpt, word_count, lang, content_type, content_length, fetched_at
		FROM bookmark_contents
		WHERE bookmark_id = ?
		LIMIT 1`,
	)
		.bind(bookmarkId)
		.first<BookmarkContentRow>();

	const [contentDocument, tags, images] = await Promise.all([
		getContentDocument(env, contentRow),
		getBookmarkTags(env, bookmarkId),
		getBookmarkImages(env, bookmarkId),
	]);

	let htmlData: string | undefined;
	if (contentRow?.html_r2_key) {
		const htmlObject = await env.KEEPROOT_CONTENT.get(contentRow.html_r2_key);
		htmlData = htmlObject ? await htmlObject.text() : undefined;
	}

	const bookmarkRecord: BookmarkRecord = {
		id: bookmarkId,
		markdownData: contentDocument?.markdownData ?? '',
		metadata: compactObject({
			...makeBookmarkMetadata(bookmarkRow, tags, images),
			htmlRef: contentRow?.html_r2_key ?? null,
			images: images.map((image) => compactObject({
				createdAt: image.created_at,
				hash: image.image_hash,
				height: image.height,
				key: image.r2_key,
				type: image.type,
				width: image.width,
			})),
			textContent: contentDocument?.textContent ?? null,
		}),
	};

	if (htmlData) {
		bookmarkRecord.htmlData = htmlData;
	}

	return bookmarkRecord;
}

export async function deleteBookmark(env: StorageEnv, userId: string, bookmarkId: string): Promise<boolean> {
	const result = await env.KEEPROOT_DB.prepare(
		'DELETE FROM bookmarks WHERE id = ? AND user_id = ?',
	)
		.bind(bookmarkId, userId)
		.run();

	return Boolean(result.meta.changes);
}
