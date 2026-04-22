import {
	MAX_AUTO_FETCH_IMAGES,
	base64ToUint8Array,
	compactObject,
	encoder,
	normalizeCanonicalUrl,
	sha256Hex,
	validateSafeUrl,
	type BookmarkImagePayload,
	type BookmarkListItem,
	type BookmarkPatchPayload,
	type BookmarkPayload,
	type BookmarkRecord,
	type StorageEnv,
} from './shared';
import { refreshBookmarkIndexes, removeBookmarkIndexes } from './search';

interface BookmarkRow {
	canonical_url: string;
	content_hash: string | null;
	content_length: number | null;
	content_ref: string | null;
	content_type: string | null;
	created_at: string;
	body_text?: string | null;
	domain: string | null;
	embedding_updated_at: string | null;
	excerpt: string | null;
	id: string;
	is_read: number;
	lang: string | null;
	last_fetched_at: string | null;
	list_id: string | null;
	notes: string | null;
	pinned: number;
	processing_state: string;
	search_updated_at: string | null;
	site_name: string | null;
	sort_order: number;
	source_id: string | null;
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

interface ParsedMarkdownImageTarget {
	sourceUrl: string;
	suffix: string;
	wrappedInAngleBrackets: boolean;
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

// ⚡ Bolt: Chunked fromCharCode avoids byte-by-byte loop concatenation and string overhead.
// Impact: Prevents memory bloat and speeds up base64 encoding of large auto-fetched images.
function base64FromBytes(bytes: Uint8Array): string {
	let binary = '';
	const chunkSize = 8192;
	for (let index = 0; index < bytes.length; index += chunkSize) {
		binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize) as unknown as number[]);
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

	if (!await validateSafeUrl(absoluteUrl)) {
		return null;
	}

	let currentUrl = absoluteUrl;
	let response: Response | null = null;
	let redirectCount = 0;

	while (redirectCount < 5) {
		response = await fetch(currentUrl, {
			headers: {
				Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
				'User-Agent': 'KeepRoot/1.0 (+https://keeproot.local)',
			},
			redirect: 'manual',
		});

		if ([301, 302, 303, 307, 308].includes(response.status)) {
			await response.body?.cancel().catch(() => {});
			const location = response.headers.get('location');
			if (!location) {
				return null;
			}
			let nextUrl: string;
			try {
				nextUrl = new URL(location, currentUrl).toString();
			} catch {
				return null;
			}
			if (!await validateSafeUrl(nextUrl)) {
				return null;
			}
			currentUrl = nextUrl;
			redirectCount += 1;
			continue;
		}
		break;
	}

	if (!response || !response.ok) {
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
		sourceUrl: response.url || currentUrl,
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

	// ⚡ Bolt: Execute image ingestion processing in parallel using Promise.all to significantly reduce I/O latency
	const fetchPromises = uniqueDiscoveredUrls.slice(0, MAX_AUTO_FETCH_IMAGES).map(async (imageUrl) => {
		const absoluteImageUrl = resolveAbsoluteImageUrl(imageUrl, pageUrl);
		if (!absoluteImageUrl || existingSourceUrls.has(absoluteImageUrl)) {
			return null;
		}

		try {
			const fetchedImage = await fetchImageAsPayload(absoluteImageUrl, pageUrl);
			if (!fetchedImage?.dataBase64) {
				return null;
			}
			const sourceCandidates = buildImageSourceCandidates(imageUrl, pageUrl, absoluteImageUrl);
			return {
				...fetchedImage,
				sourceCandidates,
			};
		} catch {
			return null;
		}
	});

	const fetchedResults = await Promise.all(fetchPromises);
	for (const fetchedImage of fetchedResults) {
		if (fetchedImage) {
			hydratedImages.push(fetchedImage);
			for (const candidate of fetchedImage.sourceCandidates) {
				existingSourceUrls.add(candidate);
			}
		}
	}

	return hydratedImages;
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

// ⚡ Bolt: Using a regex .exec() loop avoids the function execution context overhead and intermediate array allocations created by .split().filter(Boolean), while maintaining full Unicode whitespace support.
// Impact: Reduces GC pressure and improves execution speed for large text documents without breaking whitespace detection.
function countWords(content: string): number {
	if (!content) {
		return 0;
	}
	let count = 0;
	const regex = /\S+/g;
	while (regex.exec(content) !== null) {
		count++;
	}
	return count;
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
		bodyText: row.body_text,
		canonicalUrl: row.canonical_url,
		contentHash: row.content_hash,
		contentLength: row.content_length,
		contentRef: row.content_ref,
		contentType: row.content_type,
		createdAt: row.created_at,
		domain: row.domain,
		embeddingUpdatedAt: row.embedding_updated_at,
		excerpt: row.excerpt,
		id: row.id,
		imageCount: images.length,
		isRead: Boolean(row.is_read),
		lang: row.lang,
		lastFetchedAt: row.last_fetched_at,
		listId: row.list_id,
		notes: row.notes,
		pinned: Boolean(row.pinned),
		processingState: row.processing_state,
		searchUpdatedAt: row.search_updated_at,
		siteName: row.site_name,
		sortOrder: row.sort_order,
		sourceId: row.source_id,
		status: row.status,
		tags,
		title: row.title,
		updatedAt: row.updated_at,
		url: row.url,
		wordCount: row.word_count,
	});
}

function prepareBookmarkImagesQuery(env: StorageEnv, bookmarkId: string): D1PreparedStatement {
	return env.KEEPROOT_DB.prepare(
		`SELECT image_hash, r2_key, width, height, type, created_at
		FROM bookmark_images
		WHERE bookmark_id = ?
		ORDER BY created_at ASC`,
	)
		.bind(bookmarkId);
}

function prepareBookmarkTagsQuery(env: StorageEnv, bookmarkId: string): D1PreparedStatement {
	return env.KEEPROOT_DB.prepare(
		`SELECT tags.name
		FROM tags
		INNER JOIN bookmark_tags ON bookmark_tags.tag_id = tags.id
		WHERE bookmark_tags.bookmark_id = ?
		ORDER BY tags.name ASC`,
	)
		.bind(bookmarkId);
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
	const existingTags = await env.KEEPROOT_DB.prepare(
		`SELECT id, normalized_name FROM tags WHERE user_id = ? AND normalized_name IN (${placeholders})`,
	)
		.bind(userId, ...normalizedTags.map((tag) => tag.normalized))
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
				).bind(tagId, userId, tag.name, tag.normalized, createdAt),
			);
		}

		batchStatements.push(
			env.KEEPROOT_DB.prepare(
				'INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)',
			).bind(bookmarkId, tagId),
		);
	}

	await env.KEEPROOT_DB.batch(batchStatements);
}

async function syncImages(env: StorageEnv, bookmarkId: string, images: BookmarkImagePayload[], createdAt: string): Promise<void> {
	// ⚡ Bolt: Execute image ingestion processing in parallel using Promise.all and D1 batching to significantly reduce I/O latency
	const processedImages = await Promise.all(
		images
			.filter((image) => Boolean(image.dataBase64))
			.map(async (image) => {
				const bytes = base64ToUint8Array(image.dataBase64 as string);
				const imageHash = await sha256Hex(bytes);
				const variant = normalizeVariant(image.variant);
				const key = variant === 'original' ? `images/${imageHash}` : `thumbs/${imageHash}/${variant}`;
				return { image, bytes, imageHash, key };
			})
	);

	const batchStatements = [
		env.KEEPROOT_DB.prepare('DELETE FROM bookmark_images WHERE bookmark_id = ?').bind(bookmarkId),
	];
	const uploadPromises: Promise<void>[] = [];
	const seenKeys = new Set<string>();

	for (const { image, bytes, imageHash, key } of processedImages) {
		if (!seenKeys.has(key)) {
			seenKeys.add(key);
			uploadPromises.push(putIfMissing(env.KEEPROOT_CONTENT, key, bytes, image.contentType ?? 'application/octet-stream'));

			batchStatements.push(
				env.KEEPROOT_DB.prepare(
					`INSERT OR REPLACE INTO bookmark_images (bookmark_id, image_hash, r2_key, width, height, type, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?)`,
				).bind(bookmarkId, imageHash, key, image.width ?? null, image.height ?? null, image.contentType ?? null, createdAt)
			);
		}
	}

	await Promise.all([
		...uploadPromises,
		env.KEEPROOT_DB.batch(batchStatements),
	]);
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

export async function saveBookmark(
	env: StorageEnv,
	user: Pick<{ userId: string; username: string }, 'userId' | 'username'>,
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
	const notes = payload.notes?.trim() || null;
	const processingState = (payload.processingState ?? 'ready').trim().toLowerCase() || 'ready';
	const status = normalizeStatus(payload.status);
	const siteName = payload.siteName?.trim() || domain;
	const sourceId = payload.sourceId ?? null;
	const hydratedImages = await hydrateImagePayloads(payload, normalizedUrl);

	let rewrittenMarkdownData = markdownData;
	let rewrittenHtmlData = payload.htmlData;

	const contentDocument: StoredContentDocument = {
		contentHash: '',
		htmlKey: null,
		images: [],
		lang: payload.lang ?? null,
		markdownData: '',
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
		`SELECT id, created_at, is_read
		FROM bookmarks
		WHERE user_id = ? AND url_hash = ?
		LIMIT 1`,
	)
		.bind(user.userId, urlHash)
		.first<{ created_at: string; id: string; is_read: number }>();

	const bookmarkId = existingBookmark?.id ?? crypto.randomUUID();
	const createdAt = existingBookmark?.created_at ?? now;

	if (existingBookmark) {
		await env.KEEPROOT_DB.prepare(
			`UPDATE bookmarks
			SET url = ?, canonical_url = ?, url_hash = ?, title = ?, site_name = ?, domain = ?, status = ?, notes = ?, source_id = ?, processing_state = ?,
				updated_at = ?, last_fetched_at = ?, content_hash = ?, content_ref = ?, content_type = ?,
				content_length = ?, excerpt = ?, word_count = ?, lang = ?, list_id = ?, pinned = ?, sort_order = ?, is_read = ?
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
				notes,
				sourceId,
				processingState,
				now,
				now,
				contentHash,
				contentKey,
				'application/json',
				contentLength,
				excerpt,
				wordCount,
				payload.lang ?? null,
				payload.listId ?? null,
				payload.pinned ? 1 : 0,
				payload.sortOrder ?? 0,
				payload.isRead !== undefined ? (payload.isRead ? 1 : 0) : existingBookmark.is_read,
				bookmarkId,
				user.userId,
			)
			.run();
	} else {
		await env.KEEPROOT_DB.prepare(
			`INSERT INTO bookmarks
			(id, user_id, url, canonical_url, url_hash, title, site_name, domain, status, notes, source_id, processing_state, created_at, updated_at, last_fetched_at, content_hash, content_ref, content_type, content_length, excerpt, word_count, lang, list_id, pinned, sort_order, is_read)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				notes,
				sourceId,
				processingState,
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
				payload.listId ?? null,
				payload.pinned ? 1 : 0,
				payload.sortOrder ?? 0,
				payload.isRead ? 1 : 0,
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

	await refreshBookmarkIndexes(env, bookmarkId);

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
			id: bookmarkId,
			isRead: existingBookmark ? (payload.isRead !== undefined ? payload.isRead : Boolean(existingBookmark.is_read)) : Boolean(payload.isRead),
			lang: payload.lang ?? null,
			lastFetchedAt: now,
			listId: payload.listId ?? null,
			notes,
			pinned: payload.pinned ? true : false,
			processingState,
			sourceId,
			siteName,
			sortOrder: payload.sortOrder ?? 0,
			status,
			title,
			updatedAt: now,
			url: normalizedUrl,
			wordCount,
		}),
	};
}

export async function listBookmarks(env: StorageEnv, userId: string): Promise<BookmarkListItem[]> {
	// ⚡ Bolt: Using D1Database.batch() for multiple reads replaces multiple separate HTTP network roundtrips with a single roundtrip.
	// Impact: Significantly reduces latency when fetching list of bookmarks and tags.
	const [rawBookmarks, tagRows] = await env.KEEPROOT_DB.batch<BookmarkRow | { bookmark_id: string; name: string }>([
		env.KEEPROOT_DB.prepare(
			`SELECT bookmarks.id, bookmarks.url, bookmarks.canonical_url, bookmarks.title, bookmarks.site_name, bookmarks.domain, bookmarks.status, bookmarks.notes,
				bookmarks.source_id, bookmarks.processing_state, bookmarks.search_updated_at, bookmarks.embedding_updated_at, bookmarks.created_at, bookmarks.updated_at,
				bookmarks.last_fetched_at, bookmarks.content_hash, bookmarks.content_ref, bookmarks.content_type, bookmarks.content_length, bookmarks.excerpt,
				bookmarks.word_count, bookmarks.lang, bookmarks.list_id, bookmarks.pinned, bookmarks.sort_order, bookmarks.is_read,
				item_search_documents.body_text AS body_text
			FROM bookmarks
			LEFT JOIN item_search_documents
				ON item_search_documents.bookmark_id = bookmarks.id
				AND item_search_documents.user_id = bookmarks.user_id
			WHERE bookmarks.user_id = ?
			ORDER BY bookmarks.pinned DESC, bookmarks.sort_order ASC, bookmarks.created_at DESC`,
		)
			.bind(userId),

		env.KEEPROOT_DB.prepare(
			`SELECT bookmark_tags.bookmark_id, tags.name
			 FROM tags
			 INNER JOIN bookmark_tags ON bookmark_tags.tag_id = tags.id
			 WHERE tags.user_id = ?`,
		)
			.bind(userId),
	]) as [D1Result<BookmarkRow>, D1Result<{ bookmark_id: string; name: string }>];

	const tagsByBookmark = new Map<string, string[]>();
	for (const row of tagRows.results) {
		const tags = tagsByBookmark.get(row.bookmark_id) || [];
		tags.push(row.name);
		tagsByBookmark.set(row.bookmark_id, tags);
	}

	return rawBookmarks.results.map((row) => ({
		id: row.id,
		name: row.id,
		metadata: makeBookmarkMetadata(row, tagsByBookmark.get(row.id) || [], []),
	}));
}

export async function getBookmark(env: StorageEnv, userId: string, bookmarkId: string): Promise<BookmarkRecord | null> {
	const bookmarkRow = await env.KEEPROOT_DB.prepare(
		`SELECT id, url, canonical_url, title, site_name, domain, status, notes, source_id, processing_state, search_updated_at, embedding_updated_at, created_at, updated_at, last_fetched_at,
			content_hash, content_ref, content_type, content_length, excerpt, word_count, lang, list_id, pinned, sort_order, is_read
		FROM bookmarks
		WHERE id = ? AND user_id = ?
		LIMIT 1`,
	)
		.bind(bookmarkId, userId)
		.first<BookmarkRow>();

	if (!bookmarkRow) {
		return null;
	}

	// ⚡ Bolt: Using D1Database.batch() for multiple reads replaces multiple separate HTTP network roundtrips with a single roundtrip.
	// Impact: Significantly reduces latency when fetching a bookmark by batching the content, tags, and images queries together.
	const [contentResult, tagsResult, imagesResult] = await env.KEEPROOT_DB.batch<BookmarkContentRow | { name: string } | BookmarkImageRow>([
		env.KEEPROOT_DB.prepare(
			`SELECT content_hash, r2_key, html_r2_key, excerpt, word_count, lang, content_type, content_length, fetched_at
			FROM bookmark_contents
			WHERE bookmark_id = ?
			LIMIT 1`,
		).bind(bookmarkId),
		prepareBookmarkTagsQuery(env, bookmarkId),
		prepareBookmarkImagesQuery(env, bookmarkId),
	]) as [D1Result<BookmarkContentRow>, D1Result<{ name: string }>, D1Result<BookmarkImageRow>];

	const contentRow = contentResult.results[0] ?? null;
	const tags = tagsResult.results.map((row) => row.name);
	const images = imagesResult.results;

	// ⚡ Bolt: Run R2 fetches concurrently after fetching their keys from D1.
	const [contentDocument, htmlData] = await Promise.all([
		getContentDocument(env, contentRow),
		contentRow?.html_r2_key ? env.KEEPROOT_CONTENT.get(contentRow.html_r2_key).then(o => o ? o.text() : undefined) : undefined,
	]);

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
		name: bookmarkId,
	};

	if (htmlData) {
		bookmarkRecord.htmlData = htmlData;
	}

	return bookmarkRecord;
}

export async function deleteBookmark(env: StorageEnv, userId: string, bookmarkId: string): Promise<boolean> {
	const existing = await env.KEEPROOT_DB.prepare(
		'SELECT id FROM bookmarks WHERE id = ? AND user_id = ? LIMIT 1',
	)
		.bind(bookmarkId, userId)
		.first<{ id: string }>();

	if (!existing) {
		return false;
	}

	await removeBookmarkIndexes(env, bookmarkId);
	const result = await env.KEEPROOT_DB.prepare(
		'DELETE FROM bookmarks WHERE id = ? AND user_id = ?',
	)
		.bind(bookmarkId, userId)
		.run();

	return Boolean(result.meta.changes);
}

export async function patchBookmark(env: StorageEnv, userId: string, bookmarkId: string, payload: BookmarkPatchPayload): Promise<boolean> {
	const updates: string[] = [];
	const bindings: unknown[] = [];
	const now = new Date().toISOString();

	if (payload.isRead !== undefined) {
		updates.push('is_read = ?');
		bindings.push(payload.isRead ? 1 : 0);
	}
	if (payload.listId !== undefined) {
		updates.push('list_id = ?');
		bindings.push(payload.listId);
	}
	if (payload.pinned !== undefined) {
		updates.push('pinned = ?');
		bindings.push(payload.pinned ? 1 : 0);
	}
	if (payload.sortOrder !== undefined) {
		updates.push('sort_order = ?');
		bindings.push(payload.sortOrder);
	}
	if (payload.title !== undefined) {
		updates.push('title = ?');
		bindings.push(payload.title.trim() || 'Untitled');
	}
	if (payload.notes !== undefined) {
		updates.push('notes = ?');
		bindings.push(payload.notes?.trim() || null);
	}
	if (payload.status !== undefined) {
		updates.push('status = ?');
		bindings.push(normalizeStatus(payload.status));
	}

	let bookmarkExists = true;
	if (updates.length > 0) {
		updates.push('updated_at = ?');
		bindings.push(now);
		bindings.push(bookmarkId, userId);
		const result = await env.KEEPROOT_DB.prepare(
			`UPDATE bookmarks SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
		).bind(...bindings).run();
		bookmarkExists = result.meta.changes > 0;
		if (!bookmarkExists && payload.tags === undefined) {
			return false;
		}
	} else if (payload.tags !== undefined) {
		const existing = await env.KEEPROOT_DB.prepare(
			'SELECT id FROM bookmarks WHERE id = ? AND user_id = ? LIMIT 1',
		)
			.bind(bookmarkId, userId)
			.first<{ id: string }>();
		bookmarkExists = Boolean(existing);
		if (!bookmarkExists) {
			return false;
		}
	}

	if (payload.tags !== undefined) {
		await syncTags(env, userId, bookmarkId, payload.tags, now);
		await env.KEEPROOT_DB.prepare(
			'UPDATE bookmarks SET updated_at = ? WHERE id = ? AND user_id = ?',
		)
			.bind(now, bookmarkId, userId)
			.run();
	}

	if (
		bookmarkExists
		&& (
			payload.title !== undefined
			|| payload.notes !== undefined
			|| payload.status !== undefined
			|| payload.tags !== undefined
		)
	) {
		await refreshBookmarkIndexes(env, bookmarkId);
	}

	return true;
}
