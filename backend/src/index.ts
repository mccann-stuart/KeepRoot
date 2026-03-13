/**
 * KeepRoot Cloudflare Worker API
 */

import { viewerHtml } from './viewer';
import { swJs } from './sw';
import {
	authenticateBearerToken,
	createApiKey,
	createList,
	createSession,
	createSmartList,
	createUserWithCredential,
	deleteApiKey,
	deleteAuthChallenge,
	deleteBookmark,
	deleteList,
	deleteSmartList,
	getBookmark,
	getUserByUsername,
	getUserCredentials,
	getValidAuthChallenge,
	listApiKeys,
	listBookmarks,
	listUserLists,
	listUserSmartLists,
	patchBookmark,
	saveBookmark,
	storeAuthChallenge,
	updateCredentialCounter,
	updateList,
	updateSmartList,
	type BookmarkPayload,
	type StorageEnv,
} from './storage';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import type { VerifiedAuthenticationResponse, VerifiedRegistrationResponse } from '@simplewebauthn/server';

export interface Env extends StorageEnv {}

const RP_NAME = 'KeepRoot';
const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function normalizePathname(pathname: string): string {
	let normalizedPathname = pathname.replace(/\/{2,}/g, '/');

	if (normalizedPathname.length > 1 && normalizedPathname.endsWith('/')) {
		normalizedPathname = normalizedPathname.slice(0, -1);
	}

	if (normalizedPathname === '/bookmarks/bookmarks') {
		return '/bookmarks';
	}

	if (normalizedPathname.startsWith('/bookmarks/bookmarks/')) {
		return normalizedPathname.replace('/bookmarks/bookmarks/', '/bookmarks/');
	}

	return normalizedPathname;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...corsHeaders,
		},
	});
}

function textResponse(body: string, contentType: string): Response {
	return new Response(body, {
		status: 200,
		headers: {
			'Content-Type': contentType,
			...corsHeaders,
		},
	});
}

function errorResponse(message: string, status: number): Response {
	return jsonResponse({ error: message }, status);
}

async function parseJson<T>(request: Request): Promise<T> {
	return request.json() as Promise<T>;
}

async function loadWebAuthn() {
	return import('@simplewebauthn/server');
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const pathname = normalizePathname(url.pathname);
		const rpID = url.hostname;
		const origin = url.origin;

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		if (request.method === 'GET' && pathname === '/') {
			return textResponse(viewerHtml, 'text/html;charset=UTF-8');
		}

		if (request.method === 'GET' && pathname === '/sw.js') {
			return textResponse(swJs, 'application/javascript;charset=UTF-8');
		}

		if (request.method === 'GET' && (pathname.startsWith('/images/') || pathname.startsWith('/thumbs/'))) {
			const objectKey = pathname.slice(1);
			const objectBody = await env.KEEPROOT_CONTENT.get(objectKey);
			if (!objectBody) {
				return errorResponse('Not found', 404);
			}

			const headers = new Headers();
			objectBody.writeHttpMetadata(headers);
			headers.set('etag', objectBody.httpEtag);
			headers.set('Cache-Control', 'public, max-age=31536000, immutable');
			for (const [key, value] of Object.entries(corsHeaders)) {
				headers.set(key, value);
			}

			return new Response(objectBody.body, { headers });
		}

		if (request.method === 'POST' && pathname === '/auth/generate-registration') {
			try {
				const { username } = await parseJson<{ username?: string }>(request);
				const normalizedUsername = username?.trim();
				if (!normalizedUsername) {
					return errorResponse('Username required', 400);
				}

				const existingUser = await getUserByUsername(env, normalizedUsername);
				if (existingUser) {
					return errorResponse('User already exists', 400);
				}

				const { generateRegistrationOptions } = await loadWebAuthn();
				const userId = crypto.randomUUID();
				const options = await generateRegistrationOptions({
					attestationType: 'none',
					authenticatorSelection: {
						residentKey: 'required',
						userVerification: 'preferred',
					},
					rpID,
					rpName: RP_NAME,
					userID: new TextEncoder().encode(userId) as unknown as Uint8Array<ArrayBuffer>,
					userName: normalizedUsername,
				});

				await storeAuthChallenge(env, {
					challenge: options.challenge,
					type: 'registration',
					userId,
					username: normalizedUsername,
				});

				return jsonResponse(options);
			} catch (error) {
				console.error(error);
				return errorResponse('Invalid request', 400);
			}
		}

		if (request.method === 'POST' && pathname === '/auth/verify-registration') {
			try {
				const body = await parseJson<{ response: any; username?: string }>(request);
				const normalizedUsername = body.username?.trim();
				if (!normalizedUsername || !body.response) {
					return errorResponse('Invalid registration payload', 400);
				}

				const challenge = await getValidAuthChallenge(env, normalizedUsername, 'registration');
				if (!challenge?.user_id) {
					return errorResponse('Session expired', 400);
				}

				const { verifyRegistrationResponse } = await loadWebAuthn();
				let verification: VerifiedRegistrationResponse;
				try {
					verification = await verifyRegistrationResponse({
						expectedChallenge: challenge.challenge,
						expectedOrigin: origin,
						expectedRPID: rpID,
						response: body.response,
					});
				} catch (error) {
					console.error(error);
					return errorResponse('Verification failed', 400);
				}

				if (!verification.verified || !verification.registrationInfo) {
					return errorResponse('Verification failed', 400);
				}

				const existingUser = await getUserByUsername(env, normalizedUsername);
				if (existingUser) {
					return errorResponse('User already exists', 400);
				}

				const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo;
				await createUserWithCredential(env, normalizedUsername, challenge.user_id, {
					backedUp: credentialBackedUp,
					counter: credential.counter,
					credentialId: credential.id,
					deviceType: credentialDeviceType ?? null,
					publicKey: new Uint8Array(credential.publicKey),
					transports: credential.transports,
				});
				await deleteAuthChallenge(env, normalizedUsername, 'registration');

				const token = await createSession(env, {
					userId: challenge.user_id,
					username: normalizedUsername,
				});

				return jsonResponse({ token, verified: true });
			} catch (error) {
				console.error(error);
				return errorResponse('Unable to verify registration', 500);
			}
		}

		if (request.method === 'POST' && pathname === '/auth/generate-authentication') {
			try {
				const { username } = await parseJson<{ username?: string }>(request);
				const normalizedUsername = username?.trim();
				if (!normalizedUsername) {
					return errorResponse('Username required', 400);
				}

				const user = await getUserByUsername(env, normalizedUsername);
				if (!user) {
					return errorResponse('User not found', 404);
				}

				const { generateAuthenticationOptions } = await loadWebAuthn();
				const credentials = await getUserCredentials(env, normalizedUsername);
				const options = await generateAuthenticationOptions({
					allowCredentials: credentials.map((credential) => ({
						id: credential.credentialId,
						transports: credential.transports as AuthenticatorTransportFuture[] | undefined,
					})),
					rpID,
					userVerification: 'preferred',
				});

				await storeAuthChallenge(env, {
					challenge: options.challenge,
					type: 'authentication',
					userId: user.id,
					username: normalizedUsername,
				});

				return jsonResponse(options);
			} catch (error) {
				console.error(error);
				return errorResponse('Unable to generate authentication options', 400);
			}
		}

		if (request.method === 'POST' && pathname === '/auth/verify-authentication') {
			try {
				const body = await parseJson<{ response: any; username?: string }>(request);
				const normalizedUsername = body.username?.trim();
				if (!normalizedUsername || !body.response) {
					return errorResponse('Invalid authentication payload', 400);
				}

				const challenge = await getValidAuthChallenge(env, normalizedUsername, 'authentication');
				if (!challenge) {
					return errorResponse('Session expired', 400);
				}

				const user = await getUserByUsername(env, normalizedUsername);
				if (!user) {
					return errorResponse('User not found', 404);
				}

				const credentials = await getUserCredentials(env, normalizedUsername);
				const authenticator = credentials.find((credential) => credential.credentialId === body.response.id);
				if (!authenticator) {
					return errorResponse('Authenticator not registered', 400);
				}

				const { verifyAuthenticationResponse } = await loadWebAuthn();
				let verification: VerifiedAuthenticationResponse;
				try {
					verification = await verifyAuthenticationResponse({
						credential: {
							counter: authenticator.counter,
							id: authenticator.credentialId,
							publicKey: authenticator.publicKey as unknown as Uint8Array<ArrayBuffer>,
							transports: authenticator.transports as AuthenticatorTransportFuture[] | undefined,
						},
						expectedChallenge: challenge.challenge,
						expectedOrigin: origin,
						expectedRPID: rpID,
						response: body.response,
					});
				} catch (error) {
					console.error(error);
					return errorResponse('Verification failed', 400);
				}

				if (!verification.verified || !verification.authenticationInfo) {
					return errorResponse('Verification failed', 400);
				}

				await updateCredentialCounter(env, normalizedUsername, authenticator.credentialId, verification.authenticationInfo.newCounter);
				await deleteAuthChallenge(env, normalizedUsername, 'authentication');

				const token = await createSession(env, {
					userId: user.id,
					username: normalizedUsername,
				});

				return jsonResponse({ token, verified: true });
			} catch (error) {
				console.error(error);
				return errorResponse('Unable to verify authentication', 500);
			}
		}

		const authHeader = request.headers.get('Authorization');
		const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
		const authUser = token ? await authenticateBearerToken(env, token) : null;

		if (!authUser) {
			return errorResponse('Unauthorized', 401);
		}

		try {
			if (request.method === 'GET' && pathname === '/api-keys') {
				const keys = await listApiKeys(env, authUser.userId);
				return jsonResponse({ keys });
			}

			if (request.method === 'POST' && pathname === '/api-keys') {
				const body = await parseJson<{ name?: string }>(request);
				const keyName = body.name?.trim() || 'Unnamed Key';
				const { metadata, secret } = await createApiKey(env, authUser, keyName);
				return jsonResponse({ metadata, secret });
			}

			if (request.method === 'DELETE' && pathname.startsWith('/api-keys/')) {
				const keyId = pathname.slice('/api-keys/'.length);
				if (!keyId) {
					return errorResponse('Missing ID', 400);
				}

				const deleted = await deleteApiKey(env, authUser.userId, keyId);
				if (!deleted) {
					return errorResponse('Key not found or unauthorized', 404);
				}

				return jsonResponse({ message: 'Deleted successfully' });
			}

			if (request.method === 'POST' && pathname === '/bookmarks') {
				const body = await parseJson<BookmarkPayload>(request);
				const { id, metadata } = await saveBookmark(env, authUser, body);
				return jsonResponse({ id, message: 'Saved successfully', metadata });
			}

			if (request.method === 'GET' && pathname === '/bookmarks') {
				const keys = await listBookmarks(env, authUser.userId);
				return jsonResponse({ keys });
			}

			if (request.method === 'PATCH' && pathname.startsWith('/bookmarks/')) {
				const bookmarkId = pathname.slice('/bookmarks/'.length);
				if (!bookmarkId) {
					return errorResponse('Missing ID', 400);
				}

				const body = await parseJson<any>(request);
				const updated = await patchBookmark(env, authUser.userId, bookmarkId, body);
				if (!updated && body.tags === undefined) {
					return errorResponse('Not found or no changes', 404);
				}

				return jsonResponse({ message: 'Updated successfully' });
			}

			if (request.method === 'GET' && pathname.startsWith('/bookmarks/')) {
				const bookmarkId = pathname.slice('/bookmarks/'.length);
				if (!bookmarkId) {
					return errorResponse('Missing ID', 400);
				}

				const bookmark = await getBookmark(env, authUser.userId, bookmarkId);
				if (!bookmark) {
					return errorResponse('Not found', 404);
				}

				return jsonResponse(bookmark);
			}

			if (request.method === 'DELETE' && pathname.startsWith('/bookmarks/')) {
				const bookmarkId = pathname.slice('/bookmarks/'.length);
				if (!bookmarkId) {
					return errorResponse('Missing ID', 400);
				}

				const deleted = await deleteBookmark(env, authUser.userId, bookmarkId);
				if (!deleted) {
					return errorResponse('Not found', 404);
				}

				return jsonResponse({ message: 'Deleted successfully' });
			}

			// Lists API
			if (request.method === 'GET' && pathname === '/lists') {
				const lists = await listUserLists(env, authUser.userId);
				return jsonResponse({ lists });
			}

			if (request.method === 'POST' && pathname === '/lists') {
				const body = await parseJson<any>(request);
				if (!body.name) return errorResponse('Name required', 400);
				const list = await createList(env, authUser.userId, body);
				return jsonResponse(list, 201);
			}

			if (request.method === 'PATCH' && pathname.startsWith('/lists/')) {
				const listId = pathname.slice('/lists/'.length);
				const body = await parseJson<any>(request);
				const updated = await updateList(env, authUser.userId, listId, body);
				if (!updated) return errorResponse('Not found', 404);
				return jsonResponse({ message: 'Updated successfully' });
			}

			if (request.method === 'DELETE' && pathname.startsWith('/lists/')) {
				const listId = pathname.slice('/lists/'.length);
				const deleted = await deleteList(env, authUser.userId, listId);
				if (!deleted) return errorResponse('Not found', 404);
				return jsonResponse({ message: 'Deleted successfully' });
			}

			// Smart Lists API
			if (request.method === 'GET' && pathname === '/smart-lists') {
				const lists = await listUserSmartLists(env, authUser.userId);
				return jsonResponse({ lists });
			}

			if (request.method === 'POST' && pathname === '/smart-lists') {
				const body = await parseJson<any>(request);
				if (!body.name || !body.rules) return errorResponse('Name and rules required', 400);
				const list = await createSmartList(env, authUser.userId, body);
				return jsonResponse(list, 201);
			}

			if (request.method === 'PATCH' && pathname.startsWith('/smart-lists/')) {
				const listId = pathname.slice('/smart-lists/'.length);
				const body = await parseJson<any>(request);
				const updated = await updateSmartList(env, authUser.userId, listId, body);
				if (!updated) return errorResponse('Not found', 404);
				return jsonResponse({ message: 'Updated successfully' });
			}

			if (request.method === 'DELETE' && pathname.startsWith('/smart-lists/')) {
				const listId = pathname.slice('/smart-lists/'.length);
				const deleted = await deleteSmartList(env, authUser.userId, listId);
				if (!deleted) return errorResponse('Not found', 404);
				return jsonResponse({ message: 'Deleted successfully' });
			}

			return errorResponse('Not found', 404);
		} catch (error) {
			console.error(error);
			return errorResponse('Internal Server Error', 500);
		}
	},
};
