/**
 * KeepRoot Cloudflare Worker API
 */

export interface Env {
	KEEPROOT_STORE: KVNamespace;
}

import { viewerHtml } from './viewer';
import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	generateAuthenticationOptions,
	verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { VerifiedRegistrationResponse, VerifiedAuthenticationResponse } from '@simplewebauthn/server';

// Optional: you can define relying party name
const RP_NAME = 'KeepRoot';



// Base64URL encode/decode helpers
function bufferToBase64URL(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (const charCode of bytes) {
        str += String.fromCharCode(charCode);
    }
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// CORS headers
const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: any, status: number = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', ...corsHeaders },
	});
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const rpID = url.hostname;
		const origin = url.origin;
		
		// Handle OPTIONS request for CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		// GET / - Web Viewer UI
		if (request.method === 'GET' && url.pathname === '/') {
			return new Response(viewerHtml, {
				status: 200,
				headers: { 'Content-Type': 'text/html;charset=UTF-8', ...corsHeaders }
			});
		}

		// WEBAUTHN ENDPOINTS
		
		// 1. Generate Registration Options
		if (request.method === 'POST' && url.pathname === '/auth/generate-registration') {
			try {
				const { username } = await request.json() as { username: string };
				if (!username) return jsonResponse({ error: 'Username required' }, 400);

				// Check if user already exists
				const existingUser = await env.KEEPROOT_STORE.get(`user:${username}`, 'json');
				if (existingUser) {
					return jsonResponse({ error: 'User already exists' }, 400);
				}

				const userID = crypto.randomUUID();
				// The authenticator expects a Uint8Array, we'll pass a string representation
				const options = await generateRegistrationOptions({
					rpName: RP_NAME,
					rpID,
					userID: new TextEncoder().encode(userID) as any,
					userName: username,
					attestationType: 'none',
					authenticatorSelection: {
						residentKey: 'required',
						userVerification: 'preferred',
					},
				});

				// Store challenge
				await env.KEEPROOT_STORE.put(`reg_challenge:${username}`, options.challenge, { expirationTtl: 300 }); // 5 mins

				// Store pending user ID
				await env.KEEPROOT_STORE.put(`pending_user:${username}`, userID, { expirationTtl: 300 });

				return jsonResponse(options);
			} catch (err: any) {
				return jsonResponse({ error: err.message }, 500);
			}
		}

		// 2. Verify Registration
		if (request.method === 'POST' && url.pathname === '/auth/verify-registration') {
			try {
				const body = await request.json() as { username: string, response: any };
				const { username, response } = body;

				const expectedChallenge = await env.KEEPROOT_STORE.get(`reg_challenge:${username}`);
				const userID = await env.KEEPROOT_STORE.get(`pending_user:${username}`);

				if (!expectedChallenge || !userID) {
					return jsonResponse({ error: 'Session expired' }, 400);
				}

				let verification: VerifiedRegistrationResponse;
				try {
					verification = await verifyRegistrationResponse({
						response,
						expectedChallenge,
						expectedOrigin: origin,
						expectedRPID: rpID,
					});
				} catch (error: any) {
					return jsonResponse({ error: error.message }, 400);
				}

				const { verified, registrationInfo } = verification;
				if (verified && registrationInfo) {
					const { credential, credentialBackedUp, credentialDeviceType } = registrationInfo;
					
					const newCredential = {
						id: credential.id,
						publicKey: Array.from(credential.publicKey),
						counter: credential.counter,
						transports: credential.transports,
					};

					// Save user
					const user = {
						id: userID,
						username,
						credentials: [newCredential]
					};
					await env.KEEPROOT_STORE.put(`user:${username}`, JSON.stringify(user));

					// Clear pending
					await env.KEEPROOT_STORE.delete(`reg_challenge:${username}`);
					await env.KEEPROOT_STORE.delete(`pending_user:${username}`);

					// Create session
					const sessionId = crypto.randomUUID();
					await env.KEEPROOT_STORE.put(`session:${sessionId}`, JSON.stringify({ userId: userID, username }), { expirationTtl: 60 * 60 * 24 * 7 }); // 7 days

					return jsonResponse({ verified: true, token: sessionId });
				} else {
					return jsonResponse({ error: 'Verification failed' }, 400);
				}
			} catch (err: any) {
				return jsonResponse({ error: err.message }, 500);
			}
		}

		// 3. Generate Authentication Options
		if (request.method === 'POST' && url.pathname === '/auth/generate-authentication') {
			try {
				const { username } = await request.json() as { username: string };
				if (!username) return jsonResponse({ error: 'Username required' }, 400);

				const user = await env.KEEPROOT_STORE.get(`user:${username}`, 'json') as any;
				if (!user) {
					return jsonResponse({ error: 'User not found' }, 404);
				}

				const options = await generateAuthenticationOptions({
					rpID,
					allowCredentials: user.credentials.map((c: any) => ({
						id: c.id,
						type: 'public-key',
						transports: c.transports,
					})),
					userVerification: 'preferred',
				});

				await env.KEEPROOT_STORE.put(`auth_challenge:${username}`, options.challenge, { expirationTtl: 300 });

				return jsonResponse(options);
			} catch (err: any) {
				return jsonResponse({ error: err.message }, 500);
			}
		}

		// 4. Verify Authentication
		if (request.method === 'POST' && url.pathname === '/auth/verify-authentication') {
			try {
				const body = await request.json() as { username: string, response: any };
				const { username, response } = body;

				const expectedChallenge = await env.KEEPROOT_STORE.get(`auth_challenge:${username}`);
				if (!expectedChallenge) {
					return jsonResponse({ error: 'Session expired' }, 400);
				}

				const user = await env.KEEPROOT_STORE.get(`user:${username}`, 'json') as any;
				if (!user) {
					return jsonResponse({ error: 'User not found' }, 404);
				}

				// Find exactly which credential was used
				const bodyCredID = response.id;
				const authenticator = user.credentials.find((c: any) => c.id === bodyCredID);

				if (!authenticator) {
					return jsonResponse({ error: 'Authenticator not registered' }, 400);
				}

				let verification: VerifiedAuthenticationResponse;
				try {
					verification = await verifyAuthenticationResponse({
						response,
						expectedChallenge,
						expectedOrigin: origin,
						expectedRPID: rpID,
						credential: {
							id: authenticator.id,
							publicKey: new Uint8Array(authenticator.publicKey),
							counter: authenticator.counter,
							transports: authenticator.transports,
						},
					});
				} catch (error: any) {
					return jsonResponse({ error: error.message }, 400);
				}

				const { verified, authenticationInfo } = verification;
				if (verified && authenticationInfo) {
					// Update counter in DB for security
					authenticator.counter = authenticationInfo.newCounter;
					await env.KEEPROOT_STORE.put(`user:${username}`, JSON.stringify(user));

					await env.KEEPROOT_STORE.delete(`auth_challenge:${username}`);

					// Create session
					const sessionId = crypto.randomUUID();
					await env.KEEPROOT_STORE.put(`session:${sessionId}`, JSON.stringify({ userId: user.id, username }), { expirationTtl: 60 * 60 * 24 * 7 });

					return jsonResponse({ verified: true, token: sessionId });
				} else {
					return jsonResponse({ error: 'Verification failed' }, 400);
				}
			} catch (err: any) {
				return jsonResponse({ error: err.message }, 500);
			}
		}

		// Authentication logic for Protected Routes
		const authHeader = request.headers.get('Authorization');
		let authUser = null;
		
		if (authHeader && authHeader.startsWith('Bearer ')) {
			const token = authHeader.substring(7);
			
			// 1. Check Session Token
			const session = await env.KEEPROOT_STORE.get(`session:${token}`, 'json') as any;
			if (session) {
				authUser = session;
			} else {
				// 2. Check API Key
				const apikeyData = await env.KEEPROOT_STORE.get(`apikey:${token}`, 'json') as any;
				if (apikeyData) {
					authUser = apikeyData;
				}
			}
		}

		if (!authUser) {
			return jsonResponse({ error: 'Unauthorized' }, 401);
		}

		// Protected endpoints below

		try {
			// GET /api-keys - List API keys for user
			if (request.method === 'GET' && url.pathname === '/api-keys') {
				const list = await env.KEEPROOT_STORE.list({ prefix: `apikey:` });
				const keys: any[] = [];
				for (const key of list.keys) {
					if (key.metadata && (key.metadata as any).userId === authUser.userId) {
						keys.push({
							id: key.name.split(':')[1], // Extract actual key ID
							name: (key.metadata as any).name || 'Unnamed Key',
							createdAt: (key.metadata as any).createdAt || new Date().toISOString()
						});
					}
				}
				return jsonResponse({ keys });
			}

			// POST /api-keys - Create new API key
			if (request.method === 'POST' && url.pathname === '/api-keys') {
				const body = await request.json() as { name?: string };
				const keyName = body.name || 'Unnamed Key';
				
				// Generate API key
				const array = new Uint8Array(24); // 48 hex chars
				crypto.getRandomValues(array);
				const newKey = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');

				const metadata = {
					userId: authUser.userId,
					username: authUser.username,
					name: keyName,
					createdAt: new Date().toISOString()
				};

				await env.KEEPROOT_STORE.put(`apikey:${newKey}`, JSON.stringify({ userId: authUser.userId, username: authUser.username }), { metadata });

				return jsonResponse({ secret: newKey, metadata });
			}

			// DELETE /api-keys/:id - Delete an API key
			if (request.method === 'DELETE' && url.pathname.startsWith('/api-keys/')) {
				const id = url.pathname.split('/api-keys/')[1];
				if (!id) return jsonResponse({ error: 'Missing ID' }, 400);

				// Verify ownership
				const { metadata } = await env.KEEPROOT_STORE.getWithMetadata(`apikey:${id}`);
				if (!metadata || (metadata as any).userId !== authUser.userId) {
					return jsonResponse({ error: 'Key not found or unauthorized' }, 404);
				}

				await env.KEEPROOT_STORE.delete(`apikey:${id}`);
				return jsonResponse({ message: 'Deleted successfully' });
			}

			// POST /bookmarks - Save a new markdown file
			if (request.method === 'POST' && url.pathname === '/bookmarks') {
				const body = await request.json() as { url?: string; title?: string; markdownData?: string };
				
				if (!body.markdownData) {
					return jsonResponse({ error: 'Missing markdownData' }, 400);
				}

				const id = crypto.randomUUID();
				const metadata = {
					url: body.url || '',
					title: body.title || 'Untitled',
					createdAt: new Date().toISOString(),
					userId: authUser.userId
				};

				await env.KEEPROOT_STORE.put(id, body.markdownData, { metadata });

				return jsonResponse({ id, message: 'Saved successfully', metadata });
			}

			// GET /bookmarks - List all bookmarks (filtering for the current user)
			if (request.method === 'GET' && url.pathname === '/bookmarks') {
				const list = await env.KEEPROOT_STORE.list();
				const userKeys = list.keys.filter(k => {
					const md = k.metadata as any;
					return md && md.userId === authUser.userId;
				});

				return jsonResponse({ keys: userKeys });
			}

			// GET /bookmarks/:id - Retrieve a specific bookmark
			if (request.method === 'GET' && url.pathname.startsWith('/bookmarks/')) {
				const id = url.pathname.split('/bookmarks/')[1];
				if (!id) {
					return jsonResponse({ error: 'Missing ID' }, 400);
				}

				const { value, metadata } = await env.KEEPROOT_STORE.getWithMetadata(id);
				
				if (!value) {
					return jsonResponse({ error: 'Not found' }, 404);
				}

				const md = metadata as any;
				if (md && md.userId !== authUser.userId) {
					return jsonResponse({ error: 'Unauthorized' }, 403);
				}

				return jsonResponse({ id, metadata, markdownData: value });
			}

			// DELETE /bookmarks/:id - Delete a specific bookmark
			if (request.method === 'DELETE' && url.pathname.startsWith('/bookmarks/')) {
				const id = url.pathname.split('/bookmarks/')[1];
				if (!id) {
					return jsonResponse({ error: 'Missing ID' }, 400);
				}

				const { metadata } = await env.KEEPROOT_STORE.getWithMetadata(id);
				const md = metadata as any;
				if (md && md.userId !== authUser.userId) {
					return jsonResponse({ error: 'Unauthorized' }, 403);
				}

				await env.KEEPROOT_STORE.delete(id);

				return jsonResponse({ message: 'Deleted successfully' });
			}

			return jsonResponse({ error: 'Not found' }, 404);

		} catch (error: any) {
			console.error(error);
			return jsonResponse({ error: 'Internal Server Error' }, 500);
		}
	},
};

