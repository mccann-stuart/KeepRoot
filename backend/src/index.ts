/**
 * KeepRoot Cloudflare Worker API
 */

export interface Env {
	KEEPROOT_STORE: KVNamespace;
	API_SECRET?: string;
}

import { viewerHtml } from './viewer';

// Performance optimization: Cache the KV API secret in memory to prevent
// redundant KV reads on every request. This reduces latency and KV operations.
let cachedKvSecret: string | null = null;

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		
		// CORS headers
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		};

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

		// Setup Endpoint - Allow initial generation of API Secret
		if (request.method === 'POST' && url.pathname === '/setup') {
			if (!cachedKvSecret && !env.API_SECRET) {
				cachedKvSecret = await env.KEEPROOT_STORE.get('KEEPROOT_API_SECRET');
			}
			const existingSecret = env.API_SECRET || cachedKvSecret;
			if (existingSecret) {
				return new Response(JSON.stringify({ error: 'Worker is already configured' }), { 
					status: 403, 
					headers: { 'Content-Type': 'application/json', ...corsHeaders } 
				});
			}

			// Generate a new secure 32-byte secret (64 hex characters)
			const array = new Uint8Array(32);
			crypto.getRandomValues(array);
			const newSecret = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
			
			// Store in KV
			await env.KEEPROOT_STORE.put('KEEPROOT_API_SECRET', newSecret);
			cachedKvSecret = newSecret; // Update the cache

			return new Response(JSON.stringify({ secret: newSecret }), { 
				status: 200, 
				headers: { 'Content-Type': 'application/json', ...corsHeaders } 
			});
		}

		// Authentication for API endpoints
		const authHeader = request.headers.get('Authorization');
		if (!cachedKvSecret && !env.API_SECRET) {
			cachedKvSecret = await env.KEEPROOT_STORE.get('KEEPROOT_API_SECRET');
		}
		const expectedSecret = env.API_SECRET || cachedKvSecret;

		if (!expectedSecret) {
			return new Response(JSON.stringify({ error: 'Worker API_SECRET is not configured. Setup required.', setupRequired: true }), { 
				status: 401, 
				headers: { 'Content-Type': 'application/json', ...corsHeaders } 
			});
		}

		if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
				status: 401, 
				headers: { 'Content-Type': 'application/json', ...corsHeaders } 
			});
		}

		try {
			// POST /bookmarks - Save a new markdown file
			if (request.method === 'POST' && url.pathname === '/bookmarks') {
				const body = await request.json() as { url?: string; title?: string; markdownData?: string };
				
				if (!body.markdownData) {
					return new Response(JSON.stringify({ error: 'Missing markdownData' }), { 
						status: 400, 
						headers: { 'Content-Type': 'application/json', ...corsHeaders } 
					});
				}

				const id = crypto.randomUUID();
				const metadata = {
					url: body.url || '',
					title: body.title || 'Untitled',
					createdAt: new Date().toISOString()
				};

				await env.KEEPROOT_STORE.put(id, body.markdownData, {
					metadata: metadata
				});

				return new Response(JSON.stringify({ id, message: 'Saved successfully', metadata }), { 
					status: 200, 
					headers: { 'Content-Type': 'application/json', ...corsHeaders } 
				});
			}

			// GET /bookmarks - List all bookmarks
			if (request.method === 'GET' && url.pathname === '/bookmarks') {
				const list = await env.KEEPROOT_STORE.list();
				return new Response(JSON.stringify({ keys: list.keys }), { 
					status: 200, 
					headers: { 'Content-Type': 'application/json', ...corsHeaders } 
				});
			}

			// GET /bookmarks/:id - Retrieve a specific bookmark
			if (request.method === 'GET' && url.pathname.startsWith('/bookmarks/')) {
				const id = url.pathname.split('/bookmarks/')[1];
				if (!id) {
					return new Response(JSON.stringify({ error: 'Missing ID' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
				}

				const { value, metadata } = await env.KEEPROOT_STORE.getWithMetadata(id);
				
				if (!value) {
					return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
				}

				return new Response(JSON.stringify({ id, metadata, markdownData: value }), { 
					status: 200, 
					headers: { 'Content-Type': 'application/json', ...corsHeaders } 
				});
			}

			// DELETE /bookmarks/:id - Delete a specific bookmark
			if (request.method === 'DELETE' && url.pathname.startsWith('/bookmarks/')) {
				const id = url.pathname.split('/bookmarks/')[1];
				if (!id) {
					return new Response(JSON.stringify({ error: 'Missing ID' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
				}

				await env.KEEPROOT_STORE.delete(id);

				return new Response(JSON.stringify({ message: 'Deleted successfully' }), { 
					status: 200, 
					headers: { 'Content-Type': 'application/json', ...corsHeaders } 
				});
			}

			return new Response(JSON.stringify({ error: 'Not found' }), { 
				status: 404, 
				headers: { 'Content-Type': 'application/json', ...corsHeaders } 
			});

		} catch (error: any) {
			console.error(error);
			return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
				status: 500, 
				headers: { 'Content-Type': 'application/json', ...corsHeaders } 
			});
		}
	},
};
