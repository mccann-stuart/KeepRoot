import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { addSource, createApiKey, createList, createSession, createSmartList, createUserWithCredential, ensureAccountSettings, hashToken, recordToolEvent, saveBookmark, storeAuthChallenge } from '../src/storage';
import initialSchemaSql from '../migrations/0001_initial.sql?raw';
import organizationSchemaSql from '../migrations/0002_organization.sql?raw';
import mcpServerSchemaSql from '../migrations/0003_mcp_server.sql?raw';
import bookmarkHotPathSchemaSql from '../migrations/0004_bookmark_hot_path.sql?raw';

const API_KEY = 'test-api-key-12345';
const TEST_USER_ID = 'test-user-id';
const TEST_USERNAME = 'testuser';
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgQJ8i1QAAAAASUVORK5CYII=';
const verifyRegistrationResponseMock = vi.fn();
const verifyAuthenticationResponseMock = vi.fn();

vi.mock('@simplewebauthn/server', () => ({
	generateAuthenticationOptions: vi.fn(),
	generateRegistrationOptions: vi.fn(),
	verifyAuthenticationResponse: verifyAuthenticationResponseMock,
	verifyRegistrationResponse: verifyRegistrationResponseMock,
}));

function mockImageFetch(responses: Record<string, { bodyBase64?: string; contentType?: string }>) {
	const originalFetch = globalThis.fetch;
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		const match = responses[url];
		if (match) {
			const bytes = Uint8Array.from(atob(match.bodyBase64 ?? TINY_PNG_BASE64), (char) => char.charCodeAt(0));
			return new Response(bytes, {
				headers: {
					'Content-Type': match.contentType ?? 'image/png',
				},
			});
		}

		return originalFetch(input, init);
	});
}

function mockTextFetch(responses: Record<string, { body: string; contentType?: string; status?: number }>) {
	const originalFetch = globalThis.fetch;
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		const match = responses[url];
		if (match) {
			return new Response(match.body, {
				headers: {
					'Content-Type': match.contentType ?? 'text/plain; charset=utf-8',
				},
				status: match.status ?? 200,
			});
		}

		return originalFetch(input, init);
	});
}

function envWithAllowedExtensionIds(...ids: string[]): typeof env & { ALLOWED_EXTENSION_IDS: string } {
	return {
		...env,
		ALLOWED_EXTENSION_IDS: JSON.stringify(ids),
	};
}

async function execStatements(sql: string, allowExisting = false): Promise<void> {
	const statements = sql
		.split(/;\s*\n/g)
		.map((statement) => statement.trim())
		.filter(Boolean);

	for (const statement of statements) {
		try {
			await env.KEEPROOT_DB.exec(statement.replace(/\s+/g, ' ').trim());
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (allowExisting && /duplicate column name|already exists/i.test(message)) {
				continue;
			}
			throw error;
		}
	}
}

async function tryExec(sql: string): Promise<void> {
	try {
		await env.KEEPROOT_DB.exec(sql.replace(/\s+/g, ' ').trim());
	} catch {
		// Ignore cleanup for optional tables in reset paths.
	}
}

async function resetDatabase(): Promise<void> {
	await execStatements(initialSchemaSql, true);
	await execStatements(organizationSchemaSql, true);
	await execStatements(mcpServerSchemaSql, true);
	await execStatements(bookmarkHotPathSchemaSql, true);
	await execStatements(`
		DELETE FROM bookmark_tags;
		DELETE FROM bookmark_images;
		DELETE FROM bookmark_contents;
		DELETE FROM bookmarks;
		DELETE FROM tags;
		DELETE FROM api_keys;
		DELETE FROM sessions;
		DELETE FROM auth_challenges;
		DELETE FROM webauthn_credentials;
		DELETE FROM users;
	`);
	await tryExec('DELETE FROM item_search_fts');
	await tryExec('DELETE FROM tool_events');
	await tryExec('DELETE FROM bookmark_embeddings');
	await tryExec('DELETE FROM item_search_documents');
	await tryExec('DELETE FROM inbox_entries');
	await tryExec('DELETE FROM source_runs');
	await tryExec('DELETE FROM sources');
	await tryExec('DELETE FROM account_settings');
	await tryExec('DELETE FROM smart_lists');
	await tryExec('DELETE FROM lists');
}

async function clearBucket(): Promise<void> {
	let listResult = await env.KEEPROOT_CONTENT.list();
	while (listResult.objects.length > 0) {
		await Promise.all(listResult.objects.map((object) => env.KEEPROOT_CONTENT.delete(object.key)));
		if (!listResult.truncated) {
			return;
		}
		listResult = await env.KEEPROOT_CONTENT.list({ cursor: listResult.cursor });
	}
}

async function seedApiKey(): Promise<void> {
	const createdAt = new Date().toISOString();
	await env.KEEPROOT_DB.prepare(
		'INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)',
	)
		.bind(TEST_USER_ID, TEST_USERNAME, createdAt)
		.run();

	await env.KEEPROOT_DB.prepare(
		`INSERT INTO api_keys (id, secret_hash, user_id, username, name, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			'test-api-key-id',
			await hashToken(API_KEY),
			TEST_USER_ID,
			TEST_USERNAME,
			'Test Key',
			createdAt,
		)
		.run();
}

async function seedUser(userId: string, username: string): Promise<void> {
	await env.KEEPROOT_DB.prepare(
		'INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)',
	)
		.bind(userId, username, new Date().toISOString())
		.run();
}

async function authedRequest(
	path: string,
	options: {
		body?: unknown;
		method?: string;
		token: string;
	} = { token: API_KEY },
): Promise<Response> {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request(`http://example.com${path}`, {
		method: options.method ?? 'GET',
		headers: {
			Authorization: `Bearer ${options.token}`,
			...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	}), env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

async function mcpRequest(method: string, params: Record<string, unknown> = {}): Promise<{ data: any; response: Response }> {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request('http://example.com/mcp', {
		method: 'POST',
		headers: {
			Accept: 'application/json, text/event-stream',
			Authorization: `Bearer ${API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			id: crypto.randomUUID(),
			jsonrpc: '2.0',
			method,
			params,
		}),
	}), env, ctx);
	const data = (await response.json()) as any;
	await waitOnExecutionContext(ctx);
	return { data, response };
}

function extractToolPayload(result: any): any {
	if (result?.structuredContent && typeof result.structuredContent === 'object') {
		return result.structuredContent;
	}

	const textBlock = Array.isArray(result?.content)
		? result.content.find((entry: { text?: string; type?: string }) => entry?.type === 'text' && typeof entry.text === 'string')
		: null;
	if (!textBlock?.text) {
		return undefined;
	}

	return JSON.parse(textBlock.text);
}

async function mcpCallTool(name: string, args: Record<string, unknown> = {}): Promise<{ payload: any; result: any }> {
	const { data, response } = await mcpRequest('tools/call', {
		arguments: args,
		name,
	});
	expect(response.status).toBe(200);
	expect(data.error).toBeUndefined();
	if (data.result?.isError) {
		const message = Array.isArray(data.result.content)
			? data.result.content.find((entry: { text?: string; type?: string }) => entry?.type === 'text' && typeof entry.text === 'string')?.text
			: undefined;
		throw new Error(`MCP tool ${name} failed: ${message ?? 'Unknown tool error'}`);
	}
	return {
		payload: extractToolPayload(data.result),
		result: data.result,
	};
}

describe('KeepRoot Worker', () => {
	beforeEach(async () => {
		vi.restoreAllMocks();
		verifyRegistrationResponseMock.mockReset();
		verifyAuthenticationResponseMock.mockReset();
		delete (env as { INGEST_QUEUE?: unknown }).INGEST_QUEUE;
		delete (env as { MCP_EMAIL_DOMAIN?: string }).MCP_EMAIL_DOMAIN;
		await resetDatabase();
		await clearBucket();
		await seedApiKey();
	});

	it('responds with 401 Unauthorized if no token provided', async () => {
		const request = new Request('http://example.com/bookmarks');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Unauthorized' });
	});

	it('responds with 401 if empty token provided', async () => {
		const request = new Request('http://example.com/bookmarks', {
			headers: { 'Authorization': '' },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Unauthorized' });
	});

	it('responds with 401 if invalid token provided', async () => {
		const request = new Request('http://example.com/bookmarks', {
			headers: { Authorization: 'Bearer invalid-token' },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Unauthorized' });
	});

	it('accepts browser extension origins during passkey registration verification', async () => {
		verifyRegistrationResponseMock.mockResolvedValue({
			registrationInfo: {
				credential: {
					counter: 0,
					id: 'registration-credential',
					publicKey: new Uint8Array([1, 2, 3]),
					transports: ['internal'],
				},
				credentialBackedUp: false,
				credentialDeviceType: 'singleDevice',
			},
			verified: true,
		});
		await storeAuthChallenge(env, {
			challenge: 'registration-challenge',
			type: 'registration',
			userId: 'registration-user-id',
			username: 'passkey-registration-user',
		});

		const request = new Request('http://example.com/auth/verify-registration', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'chrome-extension://keeproot',
			},
			body: JSON.stringify({
				response: {
					rawId: 'registration-credential',
				},
				username: 'passkey-registration-user',
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, envWithAllowedExtensionIds('keeproot'), ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(verifyRegistrationResponseMock).toHaveBeenCalledTimes(1);
		expect(verifyRegistrationResponseMock.mock.calls[0][0].expectedOrigin).toEqual([
			'http://example.com',
			'chrome-extension://keeproot',
		]);
	});

	it('rejects unapproved browser extension origins during passkey registration verification', async () => {
		verifyRegistrationResponseMock.mockImplementation(async ({ expectedOrigin }) => {
			expect(expectedOrigin).toEqual(['http://example.com']);
			throw new Error('Unexpected origin');
		});
		await storeAuthChallenge(env, {
			challenge: 'registration-challenge',
			type: 'registration',
			userId: 'registration-user-id',
			username: 'passkey-registration-user',
		});

		const request = new Request('http://example.com/auth/verify-registration', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'chrome-extension://not-allowed',
			},
			body: JSON.stringify({
				response: {
					rawId: 'registration-credential',
				},
				username: 'passkey-registration-user',
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, envWithAllowedExtensionIds('keeproot'), ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Verification failed' });
	});

	it('accepts browser extension origins during passkey authentication verification', async () => {
		await createUserWithCredential(env, 'passkey-auth-user', 'passkey-auth-user-id', {
			backedUp: false,
			counter: 0,
			credentialId: 'authentication-credential',
			deviceType: null,
			publicKey: new Uint8Array([4, 5, 6]),
			transports: ['internal'],
		});
		await storeAuthChallenge(env, {
			challenge: 'authentication-challenge',
			type: 'authentication',
			userId: 'passkey-auth-user-id',
			username: 'passkey-auth-user',
		});
		verifyAuthenticationResponseMock.mockResolvedValue({
			authenticationInfo: {
				newCounter: 1,
			},
			verified: true,
		});

		const request = new Request('http://example.com/auth/verify-authentication', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'chrome-extension://keeproot',
			},
			body: JSON.stringify({
				response: {
					rawId: 'authentication-credential',
				},
				username: 'passkey-auth-user',
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, envWithAllowedExtensionIds('keeproot'), ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(verifyAuthenticationResponseMock).toHaveBeenCalledTimes(1);
		expect(verifyAuthenticationResponseMock.mock.calls[0][0].expectedOrigin).toEqual([
			'http://example.com',
			'chrome-extension://keeproot',
		]);
	});

	it('responds with 200 and CORS headers for OPTIONS request', async () => {
		const request = new Request('http://example.com/bookmarks', {
			method: 'OPTIONS',
			headers: {
				Origin: 'chrome-extension://abcdef',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, envWithAllowedExtensionIds('abcdef'), ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://abcdef');
		expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PATCH, DELETE, OPTIONS');
		expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization');

		const text = await response.text();
		expect(text).toBe('');
	});

	it('falls back to the request origin for unapproved extension origins', async () => {
		const request = new Request('http://example.com/bookmarks', {
			method: 'OPTIONS',
			headers: {
				Origin: 'chrome-extension://abcdef',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, envWithAllowedExtensionIds('trusted-extension'), ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com');
	});

	it('returns the request origin as the allowed origin if the origin is not allowed', async () => {
		const request = new Request('http://example.com/bookmarks', {
			method: 'OPTIONS',
			headers: {
				Origin: 'http://malicious.com',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com');
	});

	it('authenticates with a valid API key', async () => {
		const request = new Request('http://example.com/bookmarks', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
	});

	it('protects and serves MCP dashboard account and stats routes', async () => {
		const unauthorizedCtx = createExecutionContext();
		const unauthorizedResponse = await worker.fetch(new Request('http://example.com/account'), env, unauthorizedCtx);
		await waitOnExecutionContext(unauthorizedCtx);

		expect(unauthorizedResponse.status).toBe(401);
		expect(await unauthorizedResponse.json()).toEqual({ error: 'Unauthorized' });

		const accountCtx = createExecutionContext();
		const accountResponse = await worker.fetch(new Request('http://example.com/account', {
			headers: {
				Authorization: `Bearer ${API_KEY}`,
			},
		}), env, accountCtx);
		await waitOnExecutionContext(accountCtx);

		expect(accountResponse.status).toBe(200);
		const account = await accountResponse.json() as any;
		expect(account.account.username).toBe(TEST_USERNAME);
		expect(account.tokenType).toBe('api_key');

		const statsCtx = createExecutionContext();
		const statsResponse = await worker.fetch(new Request('http://example.com/stats', {
			headers: {
				Authorization: `Bearer ${API_KEY}`,
			},
		}), env, statsCtx);
		await waitOnExecutionContext(statsCtx);

		expect(statsResponse.status).toBe(200);
		const stats = await statsResponse.json() as any;
		expect(stats.items.total).toBe(0);
		expect(stats.sources.total).toBe(0);
	});

	it('manages MCP sources through authenticated REST routes', async () => {
		(env as { MCP_EMAIL_DOMAIN?: string }).MCP_EMAIL_DOMAIN = 'mail.keeproot.test';
		mockTextFetch({
			'https://feeds.example.com/root.xml': {
				body: `<?xml version="1.0" encoding="UTF-8"?>
					<rss version="2.0">
						<channel>
							<title>KeepRoot Feed</title>
							<item>
								<title>Feed Story</title>
								<link>https://feeds.example.com/posts/1</link>
								<description>Fresh story from a synced source.</description>
							</item>
						</channel>
					</rss>`,
				contentType: 'application/rss+xml; charset=utf-8',
			},
		});

		const emailCtx = createExecutionContext();
		const emailResponse = await worker.fetch(new Request('http://example.com/sources', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				identifier: 'weekly-digest',
				kind: 'email',
				name: 'Digest Inbox',
				syncNow: false,
			}),
		}), env, emailCtx);
		await waitOnExecutionContext(emailCtx);

		expect(emailResponse.status).toBe(201);
		const emailSource = await emailResponse.json() as any;
		expect(emailSource.kind).toBe('email');
		expect(emailSource.emailAlias).toContain('@mail.keeproot.test');

		const rssCtx = createExecutionContext();
		const rssResponse = await worker.fetch(new Request('http://example.com/sources', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				identifier: 'https://feeds.example.com/root.xml',
				kind: 'rss',
				name: 'Root Feed',
			}),
		}), env, rssCtx);
		await waitOnExecutionContext(rssCtx);

		expect(rssResponse.status).toBe(201);
		const rssSource = await rssResponse.json() as any;
		expect(rssSource.pollUrl).toBe('https://feeds.example.com/root.xml');

		const listCtx = createExecutionContext();
		const listResponse = await worker.fetch(new Request('http://example.com/sources', {
			headers: {
				Authorization: `Bearer ${API_KEY}`,
			},
		}), env, listCtx);
		await waitOnExecutionContext(listCtx);

		expect(listResponse.status).toBe(200);
		const listed = await listResponse.json() as any;
		expect(listed.sources).toHaveLength(2);

		const statsCtx = createExecutionContext();
		const statsResponse = await worker.fetch(new Request('http://example.com/stats', {
			headers: {
				Authorization: `Bearer ${API_KEY}`,
			},
		}), env, statsCtx);
		await waitOnExecutionContext(statsCtx);

		expect(statsResponse.status).toBe(200);
		const stats = await statsResponse.json() as any;
		expect(stats.sources.total).toBe(2);
		expect(stats.sources.byKind.email).toBe(1);
		expect(stats.sources.byKind.rss).toBe(1);
		expect(stats.inbox.pending).toBe(1);

		const deleteCtx = createExecutionContext();
		const deleteResponse = await worker.fetch(new Request(`http://example.com/sources/${rssSource.id}`, {
			method: 'DELETE',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
			},
		}), env, deleteCtx);
		await waitOnExecutionContext(deleteCtx);

		expect(deleteResponse.status).toBe(200);
		expect(await deleteResponse.json()).toEqual({ removed: true });

		const afterCtx = createExecutionContext();
		const afterResponse = await worker.fetch(new Request('http://example.com/sources', {
			headers: {
				Authorization: `Bearer ${API_KEY}`,
			},
		}), env, afterCtx);
		await waitOnExecutionContext(afterCtx);

		const afterRemoval = await afterResponse.json() as any;
		expect(afterRemoval.sources).toHaveLength(1);
		expect(afterRemoval.sources[0].kind).toBe('email');
	});

	it('validates REST source creation for feature-gated email and X bridge requirements', async () => {
		const emailCtx = createExecutionContext();
		const emailResponse = await worker.fetch(new Request('http://example.com/sources', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				identifier: 'weekly-digest',
				kind: 'email',
			}),
		}), env, emailCtx);
		await waitOnExecutionContext(emailCtx);

		expect(emailResponse.status).toBe(400);
		expect(await emailResponse.json()).toEqual({
			error: 'Email sources require MCP_EMAIL_DOMAIN to be configured',
		});

		const xCtx = createExecutionContext();
		const xResponse = await worker.fetch(new Request('http://example.com/sources', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				identifier: 'https://x.com/keeproot',
				kind: 'x',
			}),
		}), env, xCtx);
		await waitOnExecutionContext(xCtx);

		expect(xResponse.status).toBe(400);
		expect(await xResponse.json()).toEqual({
			error: 'X sources require an operator-provided RSS bridge URL',
		});
	});

	it('responds with 400 Bad Request if bookmark content is missing', async () => {
		const ctx = createExecutionContext();
		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/missing-content',
				title: 'Missing Content',
			}),
		});

		const response = await worker.fetch(createReq, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Missing bookmark content' });
	});

	it('successfully creates a bookmark via POST /bookmarks', async () => {
		const ctx = createExecutionContext();
		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/success',
				title: 'Success Bookmark',
				markdownData: '# Success Content',
			}),
		});

		const response = await worker.fetch(createReq, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(201);
		const data = (await response.json()) as any;
		expect(data.id).toBeDefined();
		expect(data.message).toBe('Saved successfully');
		expect(data.metadata.url).toBe('https://example.com/success');
		expect(data.metadata.title).toBe('Success Bookmark');
	});

	it('handles bookmark CRUD operations with D1 metadata and R2 content', async () => {
		const ctx = createExecutionContext();

		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com',
				title: 'Example',
				markdownData: '# Example Content',
			}),
		});
		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;
		expect(createData.message).toBe('Saved successfully');
		expect(createData.inboxEntryId).toBeDefined();
		expect(createData.metadata.contentRef).toMatch(/^content\//);
		const id = createData.id;
		expect(id).toBeDefined();

		const contentObjects = await env.KEEPROOT_CONTENT.list();
		expect(contentObjects.objects.some((object) => object.key === createData.metadata.contentRef)).toBe(true);

		const listReq = new Request('http://example.com/bookmarks', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const listRes = await worker.fetch(listReq, env, ctx);
		expect(listRes.status).toBe(200);
		const listData = (await listRes.json()) as any;
		expect(listData.keys.some((key: any) => key.name === id)).toBe(true);
		expect(listData.keys.find((key: any) => key.id === id)?.metadata.bodyText).toBe('Example Content');

		const getReq = new Request(`http://example.com/bookmarks/${id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any;
		expect(getData.markdownData).toBe('# Example Content');
		expect(getData.metadata.title).toBe('Example');
		expect(getData.metadata.url).toBe('https://example.com/');

		const delReq = new Request(`http://example.com/bookmarks/${id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const delRes = await worker.fetch(delReq, env, ctx);
		expect(delRes.status).toBe(200);
		expect(await delRes.json()).toEqual({ message: 'Deleted successfully' });

		const getReq2 = new Request(`http://example.com/bookmarks/${id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes2 = await worker.fetch(getReq2, env, ctx);
		expect(getRes2.status).toBe(404);

		await waitOnExecutionContext(ctx);
	});

	it('stores images to R2 when markdown contains image URLs', async () => {
		const ctx = createExecutionContext();
		const dataUrl = `data:image/png;base64,${TINY_PNG_BASE64}`;
		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/with-image',
				title: 'Image Bookmark',
				markdownData: `# Image Bookmark\n\n![inline](${dataUrl})`,
			}),
		});

		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;

		const getReq = new Request(`http://example.com/bookmarks/${createData.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any;
		expect(Array.isArray(getData.metadata.images)).toBe(true);
		expect(getData.metadata.images.length).toBeGreaterThan(0);
		expect(getData.markdownData).toMatch(/^# Image Bookmark\s+!\[inline\]\(\/images\/[a-f0-9]{64}\)$/);

		const imageObjects = await env.KEEPROOT_CONTENT.list({ prefix: 'images/' });
		expect(imageObjects.objects.length).toBeGreaterThan(0);

		await waitOnExecutionContext(ctx);
	});

	it('rewrites absolute markdown image URLs to local image storage', async () => {
		const ctx = createExecutionContext();
		mockImageFetch({
			'https://cdn.example.com/article/hero.png': {},
		});

		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/articles/absolute-image',
				title: 'Absolute Image Bookmark',
				markdownData: '# Article\n\n![hero](https://cdn.example.com/article/hero.png)',
			}),
		});

		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;

		const getReq = new Request(`http://example.com/bookmarks/${createData.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any;
		expect(getData.markdownData).toMatch(/^# Article\s+!\[hero\]\(\/images\/[a-f0-9]{64}\)$/);

		await waitOnExecutionContext(ctx);
	});

	it('rewrites relative markdown image URLs using the page URL as the fetch base', async () => {
		const ctx = createExecutionContext();
		const fetchSpy = mockImageFetch({
			'https://example.com/images/hero.png': {},
		});

		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/articles/post',
				title: 'Relative Image Bookmark',
				markdownData: '# Relative\n\n![hero](../images/hero.png)',
			}),
		});

		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;
		expect(fetchSpy).toHaveBeenCalledWith('https://example.com/images/hero.png', { redirect: 'manual' });

		const getReq = new Request(`http://example.com/bookmarks/${createData.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any;
		expect(getData.markdownData).toMatch(/^# Relative\s+!\[hero\]\(\/images\/[a-f0-9]{64}\)$/);

		await waitOnExecutionContext(ctx);
	});

	it('preserves markdown image titles when rewriting stored image URLs', async () => {
		const ctx = createExecutionContext();
		mockImageFetch({
			'https://cdn.example.com/article/hero.png': {},
		});

		const createReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/articles/titled-image',
				title: 'Titled Image Bookmark',
				markdownData: '# Titled\n\n![hero](https://cdn.example.com/article/hero.png "Lead image")',
			}),
		});

		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;

		const getReq = new Request(`http://example.com/bookmarks/${createData.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any;
		expect(getData.markdownData).toMatch(/^# Titled\s+!\[hero\]\(\/images\/[a-f0-9]{64} "Lead image"\)$/);

		await waitOnExecutionContext(ctx);
	});

	it('deduplicates bookmarks by canonical URL hash and updates stored content', async () => {
		const ctx = createExecutionContext();
		const baseHeaders = {
			Authorization: `Bearer ${API_KEY}`,
			'Content-Type': 'application/json',
		};

		const firstCreateReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: baseHeaders,
			body: JSON.stringify({
				url: 'https://example.com/article/?utm_source=test',
				title: 'First Title',
				markdownData: '# First Content',
			}),
		});
		const firstCreateRes = await worker.fetch(firstCreateReq, env, ctx);
		const firstCreateData = (await firstCreateRes.json()) as any;

		const secondCreateReq = new Request('http://example.com/bookmarks', {
			method: 'POST',
			headers: baseHeaders,
			body: JSON.stringify({
				url: 'https://example.com/article',
				title: 'Updated Title',
				markdownData: '# Updated Content',
			}),
		});
		const secondCreateRes = await worker.fetch(secondCreateReq, env, ctx);
		const secondCreateData = (await secondCreateRes.json()) as any;

		expect(secondCreateData.id).toBe(firstCreateData.id);

		const listReq = new Request('http://example.com/bookmarks', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const listRes = await worker.fetch(listReq, env, ctx);
		const listData = (await listRes.json()) as any;
		expect(listData.keys).toHaveLength(1);
		expect(listData.keys[0].metadata.title).toBe('Updated Title');

		const getReq = new Request(`http://example.com/bookmarks/${firstCreateData.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getRes = await worker.fetch(getReq, env, ctx);
		const getData = (await getRes.json()) as any;
		expect(getData.markdownData).toBe('# Updated Content');
		expect(getData.metadata.canonicalUrl).toBe('https://example.com/article');

		await waitOnExecutionContext(ctx);
	});

	it('normalizes malformed bookmark routes', async () => {
		const ctx = createExecutionContext();

		const createReq = new Request('http://example.com//bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/normalized',
				title: 'Normalized Route',
				markdownData: '# Normalized Content',
			}),
		});
		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;
		expect(createData.id).toBeDefined();

		const listReq = new Request('http://example.com//bookmarks', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const listRes = await worker.fetch(listReq, env, ctx);
		expect(listRes.status).toBe(200);
		const listData = (await listRes.json()) as any;
		expect(listData.keys.some((key: any) => key.name === createData.id)).toBe(true);

		const duplicatePrefixReq = new Request('http://example.com/bookmarks/bookmarks', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: 'https://example.com/duplicate-prefix',
				title: 'Duplicated Prefix',
				markdownData: '# Duplicated Prefix Content',
			}),
		});
		const duplicatePrefixRes = await worker.fetch(duplicatePrefixReq, env, ctx);
		expect(duplicatePrefixRes.status).toBe(201);
		const duplicatePrefixData = (await duplicatePrefixRes.json()) as any;

		const getDuplicatePrefixReq = new Request(`http://example.com/bookmarks/bookmarks/${duplicatePrefixData.id}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const getDuplicatePrefixRes = await worker.fetch(getDuplicatePrefixReq, env, ctx);
		expect(getDuplicatePrefixRes.status).toBe(200);
		const getDuplicatePrefixData = (await getDuplicatePrefixRes.json()) as any;
		expect(getDuplicatePrefixData.markdownData).toBe('# Duplicated Prefix Content');

		const notFoundReq = new Request('http://example.com/not-a-route', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const notFoundRes = await worker.fetch(notFoundReq, env, ctx);
		expect(notFoundRes.status).toBe(404);

		await waitOnExecutionContext(ctx);
	});

	it('handles API key CRUD operations', async () => {
		const ctx = createExecutionContext();

		const createReq = new Request('http://example.com/api-keys', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ name: 'My Extension' }),
		});
		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;
		expect(createData.secret).toBeDefined();
		expect(createData.metadata.name).toBe('My Extension');
		expect(createData.metadata.id).toBeDefined();

		const listReq = new Request('http://example.com/api-keys', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const listRes = await worker.fetch(listReq, env, ctx);
		expect(listRes.status).toBe(200);
		const listData = (await listRes.json()) as any;
		expect(listData.keys.some((key: any) => key.id === createData.metadata.id)).toBe(true);

		const testReq = new Request('http://example.com/bookmarks', {
			headers: { Authorization: `Bearer ${createData.secret}` },
		});
		const testRes = await worker.fetch(testReq, env, ctx);
		expect(testRes.status).toBe(200);

		const delReq = new Request(`http://example.com/api-keys/${createData.metadata.id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const delRes = await worker.fetch(delReq, env, ctx);
		expect(delRes.status).toBe(200);
		expect(await delRes.json()).toEqual({ message: 'Deleted successfully' });

		await waitOnExecutionContext(ctx);
	});

	it('clears all user data for a session-authenticated user while preserving login', async () => {
		const sessionToken = await createSession(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		});
		const list = await createList(env, TEST_USER_ID, { name: 'Reading Queue' });
		const source = await addSource(env, {
			identifier: 'https://example.com/feed.xml',
			kind: 'rss',
			name: 'Root Feed',
			userId: TEST_USER_ID,
		});
		await createSmartList(env, TEST_USER_ID, {
			icon: 'R',
			name: 'Unread Feed',
			rules: 'feed unread',
		});
		await ensureAccountSettings(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		});
		await createApiKey(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		}, 'Dashboard Key');
		await recordToolEvent(env, {
			durationMs: 123,
			status: 'success',
			toolName: 'list_items',
			userId: TEST_USER_ID,
		});
		await saveBookmark(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		}, {
			htmlData: '<article><p>Saved content</p></article>',
			images: [{
				contentType: 'image/png',
				dataBase64: TINY_PNG_BASE64,
				sourceUrl: 'https://example.com/image.png',
			}],
			listId: list.id,
			markdownData: '# Saved content',
			sourceId: String(source.id),
			tags: ['reading', 'archive'],
			title: 'Saved article',
			url: 'https://example.com/saved-article',
		});

		const clearRes = await authedRequest('/account/data', {
			method: 'DELETE',
			token: sessionToken,
		});
		expect(clearRes.status).toBe(200);
		expect(await clearRes.json()).toEqual({ message: 'All data cleared' });

		const bookmarksRes = await authedRequest('/bookmarks', { token: sessionToken });
		expect(bookmarksRes.status).toBe(200);
		expect(await bookmarksRes.json()).toEqual({ keys: [] });

		const listsRes = await authedRequest('/lists', { token: sessionToken });
		expect(listsRes.status).toBe(200);
		expect(await listsRes.json()).toEqual({ lists: [] });

		const smartListsRes = await authedRequest('/smart-lists', { token: sessionToken });
		expect(smartListsRes.status).toBe(200);
		expect(await smartListsRes.json()).toEqual({ lists: [] });

		const sourcesRes = await authedRequest('/sources', { token: sessionToken });
		expect(sourcesRes.status).toBe(200);
		expect(await sourcesRes.json()).toEqual({ nextCursor: null, sources: [] });

		const apiKeysRes = await authedRequest('/api-keys', { token: sessionToken });
		expect(apiKeysRes.status).toBe(200);
		expect(await apiKeysRes.json()).toEqual({ keys: [] });

		const counts = await env.KEEPROOT_DB.batch([
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM users WHERE id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM api_keys WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM lists WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM smart_lists WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM sources WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM tags WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM tool_events WHERE user_id = ?').bind(TEST_USER_ID),
			env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM account_settings WHERE user_id = ?').bind(TEST_USER_ID),
		]) as Array<{ results: Array<{ count: number }> }>;

		expect(counts[0].results[0]?.count).toBe(1);
		expect(counts[1].results[0]?.count).toBeGreaterThan(0);
		expect(counts[2].results[0]?.count).toBe(0);
		expect(counts[3].results[0]?.count).toBe(0);
		expect(counts[4].results[0]?.count).toBe(0);
		expect(counts[5].results[0]?.count).toBe(0);
		expect(counts[6].results[0]?.count).toBe(0);
		expect(counts[7].results[0]?.count).toBe(0);
		expect(counts[8].results[0]?.count).toBe(0);
		expect(counts[9].results[0]?.count).toBe(0);
	});

	it('rejects clear all data when authenticated with an API key', async () => {
		const response = await authedRequest('/account/data', {
			method: 'DELETE',
			token: API_KEY,
		});

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'Clear all data requires a signed-in dashboard session' });
	});

	it('keeps shared R2 objects when another user still references them', async () => {
		const sessionToken = await createSession(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		});
		await seedUser('other-user-id', 'other-user');

		const firstBookmark = await saveBookmark(env, {
			userId: TEST_USER_ID,
			username: TEST_USERNAME,
		}, {
			htmlData: '<article><p>Shared content</p></article>',
			images: [{
				contentType: 'image/png',
				dataBase64: TINY_PNG_BASE64,
				sourceUrl: 'https://example.com/shared-image.png',
			}],
			markdownData: '# Shared content',
			title: 'Shared article',
			url: 'https://example.com/shared-article',
		});

		await saveBookmark(env, {
			userId: 'other-user-id',
			username: 'other-user',
		}, {
			htmlData: '<article><p>Shared content</p></article>',
			images: [{
				contentType: 'image/png',
				dataBase64: TINY_PNG_BASE64,
				sourceUrl: 'https://example.com/shared-image.png',
			}],
			markdownData: '# Shared content',
			title: 'Shared article',
			url: 'https://example.com/shared-article',
		});

		const sharedRefs = await env.KEEPROOT_DB.batch([
			env.KEEPROOT_DB.prepare(
				'SELECT r2_key, html_r2_key FROM bookmark_contents WHERE bookmark_id = ? LIMIT 1',
			).bind(firstBookmark.id),
			env.KEEPROOT_DB.prepare(
				'SELECT r2_key FROM bookmark_images WHERE bookmark_id = ? LIMIT 1',
			).bind(firstBookmark.id),
		]) as [D1Result<{ html_r2_key: string | null; r2_key: string | null }>, D1Result<{ r2_key: string | null }>];

		const contentKey = sharedRefs[0].results[0]?.r2_key;
		const htmlKey = sharedRefs[0].results[0]?.html_r2_key;
		const imageKey = sharedRefs[1].results[0]?.r2_key;
		expect(contentKey).toBeTruthy();
		expect(htmlKey).toBeTruthy();
		expect(imageKey).toBeTruthy();

		const clearRes = await authedRequest('/account/data', {
			method: 'DELETE',
			token: sessionToken,
		});
		expect(clearRes.status).toBe(200);

		const contentObject = await env.KEEPROOT_CONTENT.get(contentKey!);
		const htmlObject = await env.KEEPROOT_CONTENT.get(htmlKey!);
		const imageObject = await env.KEEPROOT_CONTENT.get(imageKey!);
		expect(contentObject).not.toBeNull();
		expect(htmlObject).not.toBeNull();
		expect(imageObject).not.toBeNull();
		await contentObject?.text();
		await htmlObject?.text();
		await imageObject?.arrayBuffer();

		const remaining = await env.KEEPROOT_DB.prepare(
			'SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ?',
		)
			.bind('other-user-id')
			.first<{ count: number }>();
		expect(remaining?.count).toBe(1);
	});

	it('bootstraps organization schema and supports list CRUD', async () => {
		const ctx = createExecutionContext();

		const createReq = new Request('http://example.com/lists', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ name: 'Reading Queue' }),
		});
		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;
		expect(createData.name).toBe('Reading Queue');
		expect(createData.id).toBeDefined();

		const listReq = new Request('http://example.com/lists', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const listRes = await worker.fetch(listReq, env, ctx);
		expect(listRes.status).toBe(200);
		const listData = (await listRes.json()) as any;
		expect(listData.lists.some((list: any) => list.id === createData.id && list.name === 'Reading Queue')).toBe(true);

		const updateReq = new Request(`http://example.com/lists/${createData.id}`, {
			method: 'PATCH',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ name: 'Updated Queue' }),
		});
		const updateRes = await worker.fetch(updateReq, env, ctx);
		expect(updateRes.status).toBe(200);

		const deleteReq = new Request(`http://example.com/lists/${createData.id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const deleteRes = await worker.fetch(deleteReq, env, ctx);
		expect(deleteRes.status).toBe(200);

		await waitOnExecutionContext(ctx);
	});

	it('supports smart-list CRUD with validated PATCH payloads', async () => {
		const ctx = createExecutionContext();

		const createReq = new Request('http://example.com/smart-lists', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ icon: 'star', name: 'Travel', rules: 'visa, schengen' }),
		});
		const createRes = await worker.fetch(createReq, env, ctx);
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as any;
		expect(createData.id).toBeDefined();
		expect(createData.name).toBe('Travel');
		expect(createData.rules).toBe('visa, schengen');
		expect(createData.icon).toBe('star');
		expect(createData.sortOrder).toBe(0);

		const listReq = new Request('http://example.com/smart-lists', {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const listRes = await worker.fetch(listReq, env, ctx);
		expect(listRes.status).toBe(200);
		const listData = (await listRes.json()) as any;
		expect(listData.lists.some((list: any) => list.id === createData.id && list.rules === 'visa, schengen')).toBe(true);

		const invalidUpdateReq = new Request(`http://example.com/smart-lists/${createData.id}`, {
			method: 'PATCH',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ rules: '   ' }),
		});
		const invalidUpdateRes = await worker.fetch(invalidUpdateReq, env, ctx);
		expect(invalidUpdateRes.status).toBe(400);
		expect(await invalidUpdateRes.json()).toEqual({ error: 'Rules required' });

		const updateReq = new Request(`http://example.com/smart-lists/${createData.id}`, {
			method: 'PATCH',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ name: 'Travel Planning', rules: 'visa planning' }),
		});
		const updateRes = await worker.fetch(updateReq, env, ctx);
		expect(updateRes.status).toBe(200);

		const missingUpdateReq = new Request('http://example.com/smart-lists/does-not-exist', {
			method: 'PATCH',
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({}),
		});
		const missingUpdateRes = await worker.fetch(missingUpdateReq, env, ctx);
		expect(missingUpdateRes.status).toBe(404);

		const deleteReq = new Request(`http://example.com/smart-lists/${createData.id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		const deleteRes = await worker.fetch(deleteReq, env, ctx);
		expect(deleteRes.status).toBe(200);

		await waitOnExecutionContext(ctx);
	});

	it('serves the MCP tool surface for item workflows', async () => {
		mockTextFetch({
			'https://content.example.com/article': {
				body: `<!doctype html>
					<html lang="en">
						<head><title>Alpha Article</title></head>
						<body>
							<main>
								<h1>Alpha Article</h1>
								<p>Alpha semantic content for MCP search coverage.</p>
							</main>
						</body>
					</html>`,
				contentType: 'text/html; charset=utf-8',
			},
		});

		const toolsResponse = await mcpRequest('tools/list');
		expect(toolsResponse.response.status).toBe(200);
		const toolNames = toolsResponse.data.result.tools.map((tool: { name: string }) => tool.name);
		expect(toolNames).toEqual(expect.arrayContaining([
			'save_item',
			'search_items',
			'list_items',
			'get_item',
			'update_item',
			'whoami',
			'list_sources',
			'add_source',
			'remove_source',
			'get_stats',
			'list_inbox',
			'mark_done',
		]));

		const whoAmI = await mcpCallTool('whoami');
		expect(whoAmI.payload.account.username).toBe(TEST_USERNAME);
		expect(whoAmI.payload.account.plan).toBe('self_hosted');

		const saved = await mcpCallTool('save_item', {
			notes: 'Captured via MCP',
			tags: ['Alpha', 'MCP'],
			url: 'https://content.example.com/article',
		});
		const itemId = saved.payload.id;
		expect(itemId).toBeDefined();
		expect(saved.payload.inboxEntryId).toBeDefined();

		const listed = await mcpCallTool('list_items', {
			limit: 10,
			status: 'saved',
		});
		expect(listed.payload.items).toHaveLength(1);
		expect(listed.payload.items[0].id).toBe(itemId);

		const searched = await mcpCallTool('search_items', {
			limit: 10,
			query: 'semantic alpha',
		});
		expect(searched.payload.items).toHaveLength(1);
		expect(searched.payload.items[0].id).toBe(itemId);

		const fetched = await mcpCallTool('get_item', {
			id: itemId,
			includeContent: true,
		});
		expect(fetched.payload.id).toBe(itemId);
		expect(fetched.payload.markdownData).toContain('Alpha semantic content for MCP search coverage.');

		const updated = await mcpCallTool('update_item', {
			id: itemId,
			notes: 'Updated from MCP',
			status: 'archived',
			tags: ['mcp', 'updated'],
			title: 'Alpha Article Revised',
		});
		expect(updated.payload.metadata.status).toBe('archived');
		expect(updated.payload.metadata.title).toBe('Alpha Article Revised');
		expect(updated.payload.metadata.notes).toBe('Updated from MCP');

		const inbox = await mcpCallTool('list_inbox');
		expect(inbox.payload.entries).toHaveLength(1);
		expect(inbox.payload.entries[0].item.id).toBe(itemId);

		const marked = await mcpCallTool('mark_done', {
			id: inbox.payload.entries[0].id,
		});
		expect(marked.payload.state).toBe('done');

		const stats = await mcpCallTool('get_stats');
		expect(stats.payload.items.total).toBe(1);
		expect(stats.payload.items.byStatus.archived).toBe(1);
		expect(stats.payload.inbox.pending).toBe(0);
		expect(stats.payload.recentToolUsage.length).toBeGreaterThan(0);
	});

	it('throttles api key last_used_at writes for repeated MCP requests', async () => {
		const before = await env.KEEPROOT_DB.prepare(
			'SELECT last_used_at FROM api_keys WHERE id = ?',
		)
			.bind('test-api-key-id')
			.first<{ last_used_at: string | null }>();
		expect(before?.last_used_at ?? null).toBeNull();

		await mcpRequest('tools/list');
		const first = await env.KEEPROOT_DB.prepare(
			'SELECT last_used_at FROM api_keys WHERE id = ?',
		)
			.bind('test-api-key-id')
			.first<{ last_used_at: string | null }>();

		await mcpRequest('tools/list');
		const second = await env.KEEPROOT_DB.prepare(
			'SELECT last_used_at FROM api_keys WHERE id = ?',
		)
			.bind('test-api-key-id')
			.first<{ last_used_at: string | null }>();

		expect(first?.last_used_at).toBeTruthy();
		expect(second?.last_used_at).toBe(first?.last_used_at);
	});

	it('manages MCP sources, subscriptions, and inbox sync state', async () => {
		(env as { MCP_EMAIL_DOMAIN?: string }).MCP_EMAIL_DOMAIN = 'mail.keeproot.test';
		mockTextFetch({
			'https://feeds.example.com/root.xml': {
				body: `<?xml version="1.0" encoding="UTF-8"?>
					<rss version="2.0">
						<channel>
							<title>KeepRoot Feed</title>
							<item>
								<title>Feed Story</title>
								<link>https://feeds.example.com/posts/1</link>
								<description>Fresh story from a synced source.</description>
							</item>
						</channel>
					</rss>`,
				contentType: 'application/rss+xml; charset=utf-8',
			},
		});

		const emailSource = await mcpCallTool('add_source', {
			identifier: 'weekly-digest',
			kind: 'email',
			name: 'Digest Inbox',
			syncNow: false,
		});
		expect(emailSource.payload.kind).toBe('email');
		expect(emailSource.payload.emailAlias).toContain('@mail.keeproot.test');

		const rssSource = await mcpCallTool('add_source', {
			identifier: 'https://feeds.example.com/root.xml',
			kind: 'rss',
			name: 'Root Feed',
		});
		const rssSourceId = rssSource.payload.id;
		expect(rssSource.payload.pollUrl).toBe('https://feeds.example.com/root.xml');

		const listed = await mcpCallTool('list_sources');
		expect(listed.payload.sources).toHaveLength(2);

		const inbox = await mcpCallTool('list_inbox');
		expect(inbox.payload.entries).toHaveLength(1);
		expect(inbox.payload.entries[0].source.id).toBe(rssSourceId);

		const statsBeforeDone = await mcpCallTool('get_stats');
		expect(statsBeforeDone.payload.sources.total).toBe(2);
		expect(statsBeforeDone.payload.sources.byKind.email).toBe(1);
		expect(statsBeforeDone.payload.sources.byKind.rss).toBe(1);
		expect(statsBeforeDone.payload.inbox.pending).toBe(1);

		await mcpCallTool('mark_done', {
			id: inbox.payload.entries[0].id,
		});

		const removed = await mcpCallTool('remove_source', {
			id: rssSourceId,
		});
		expect(removed.payload.removed).toBe(true);

		const afterRemoval = await mcpCallTool('list_sources');
		expect(afterRemoval.payload.sources).toHaveLength(1);
		expect(afterRemoval.payload.sources[0].kind).toBe('email');
	});

	it('delegates static assets and returns 404 for missing public assets', async () => {
		const ctx = createExecutionContext();
		const homeResponse = await worker.fetch(new Request('http://example.com/'), env, ctx);
		const serviceWorkerResponse = await worker.fetch(new Request('http://example.com/sw.js'), env, ctx);
		const missingResponse = await worker.fetch(new Request('http://example.com/nonexistent'), env, ctx);
		await waitOnExecutionContext(ctx);

		expect(homeResponse.status).toBe(200);
		expect(homeResponse.headers.get('content-type')).toContain('text/html');
		expect(await homeResponse.text()).toContain('KeepRoot Dashboard');

		expect(serviceWorkerResponse.status).toBe(200);
		expect(serviceWorkerResponse.headers.get('content-type')).toContain('javascript');
		expect(await serviceWorkerResponse.text()).toContain('keeproot-v2');

		expect(missingResponse.status).toBe(404);
	});
});
