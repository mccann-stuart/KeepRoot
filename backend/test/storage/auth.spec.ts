import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateBearerToken } from '../../src/storage/auth';
import { hashToken } from '../../src/storage/shared';
import { runSchemaStatement } from '../../src/storage/shared';

describe('auth storage', () => {
    beforeEach(async () => {
        vi.restoreAllMocks();

        // Use runSchemaStatement from shared to create tables
        await runSchemaStatement(env as any, `
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                token_hash TEXT NOT NULL,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
        `);

        await runSchemaStatement(env as any, `
            CREATE TABLE IF NOT EXISTS api_keys (
                id TEXT PRIMARY KEY,
                secret_hash TEXT NOT NULL,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                last_used_at TEXT
            )
        `);

        // Clean up database tables before each test
        await env.KEEPROOT_DB.prepare('DELETE FROM sessions').run();
        await env.KEEPROOT_DB.prepare('DELETE FROM api_keys').run();
    });

    describe('authenticateBearerToken', () => {
		it('rejects a preview session outside its scoped origin', async () => {
			const token = 'preview.v1.aHR0cHM6Ly9mZWF0dXJlLWtlZXByb290LmV4YW1wbGUud29ya2Vycy5kZXY.36fd3fe1-6382-4db3-bda3-f8804ca39456';
			await env.KEEPROOT_DB.prepare(
				`INSERT INTO sessions (id, token_hash, user_id, username, created_at, expires_at)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			).bind(
				crypto.randomUUID(),
				await hashToken(token),
				'user-preview',
				'preview_user',
				new Date().toISOString(),
				new Date(Date.now() + 60 * 60 * 1000).toISOString(),
			).run();

			const authenticate = authenticateBearerToken as unknown as (
				env: typeof import('cloudflare:test').env,
				token: string,
				requestOrigin: string,
			) => Promise<unknown>;
			expect(await authenticate(env, token, 'https://feature-keeproot.example.workers.dev')).toEqual({
				tokenType: 'session',
				userId: 'user-preview',
				username: 'preview_user',
			});
			expect(await authenticate(env, token, 'https://keeproot.example.workers.dev')).toBeNull();
		});

        it('returns valid session user and ignores expired sessions', async () => {
            const token = crypto.randomUUID();
            const tokenHash = await hashToken(token);

            // Insert expired session
            await env.KEEPROOT_DB.prepare(
                `INSERT INTO sessions (id, token_hash, user_id, username, created_at, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
            ).bind(
                crypto.randomUUID(),
                await hashToken(crypto.randomUUID()),
                'user123',
                'john_doe',
                new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
                new Date(Date.now() - 60 * 60 * 1000).toISOString() // expired 1 hr ago
            ).run();

            // Insert valid session
            await env.KEEPROOT_DB.prepare(
                `INSERT INTO sessions (id, token_hash, user_id, username, created_at, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
            ).bind(
                crypto.randomUUID(),
                tokenHash,
                'user456',
                'jane_doe',
                new Date().toISOString(),
                new Date(Date.now() + 60 * 60 * 1000).toISOString() // expires in 1 hr
            ).run();

            const result = await authenticateBearerToken(env as any, token);

            expect(result).toEqual({
                tokenType: 'session',
                userId: 'user456',
                username: 'jane_doe'
            });
        });

        it('returns valid API key user and respects last_used_at throttling limit', async () => {
            const token = crypto.randomUUID();
            const tokenHash = await hashToken(token);
            const keyId = crypto.randomUUID();

            // First time - null last_used_at (should trigger update)
            await env.KEEPROOT_DB.prepare(
                `INSERT INTO api_keys (id, secret_hash, user_id, username, name, created_at, expires_at, last_used_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                keyId,
                tokenHash,
                'user789',
                'bob_smith',
                'My Key',
                new Date().toISOString(),
                new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
                null
            ).run();

            const result1 = await authenticateBearerToken(env as any, token);

            expect(result1).toEqual({
                tokenType: 'api_key',
                userId: 'user789',
                username: 'bob_smith'
            });

            // Check that last_used_at was updated
            const keyAfterFirstUse = await env.KEEPROOT_DB.prepare(
                'SELECT last_used_at FROM api_keys WHERE id = ?'
            ).bind(keyId).first<{ last_used_at: string }>();

            expect(keyAfterFirstUse?.last_used_at).not.toBeNull();

            // Second time - last_used_at is very recent (should NOT trigger update)
            const result2 = await authenticateBearerToken(env as any, token);
            expect(result2).toEqual({
                tokenType: 'api_key',
                userId: 'user789',
                username: 'bob_smith'
            });

            // Update last_used_at to be older than the 1hr threshold
            await env.KEEPROOT_DB.prepare(
                'UPDATE api_keys SET last_used_at = ? WHERE id = ?'
            ).bind(
                new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
                keyId
            ).run();

            const keyBeforeThirdUse = await env.KEEPROOT_DB.prepare(
                'SELECT last_used_at FROM api_keys WHERE id = ?'
            ).bind(keyId).first<{ last_used_at: string }>();

            // Third time - older than threshold (should trigger update again)
            const result3 = await authenticateBearerToken(env as any, token);
            expect(result3).toEqual({
                tokenType: 'api_key',
                userId: 'user789',
                username: 'bob_smith'
            });

            const keyAfterThirdUse = await env.KEEPROOT_DB.prepare(
                'SELECT last_used_at FROM api_keys WHERE id = ?'
            ).bind(keyId).first<{ last_used_at: string }>();

            expect(keyAfterThirdUse?.last_used_at).not.toEqual(keyBeforeThirdUse?.last_used_at);
        });

        it('ignores expired API keys', async () => {
            const token = crypto.randomUUID();
            const tokenHash = await hashToken(token);

            await env.KEEPROOT_DB.prepare(
                `INSERT INTO api_keys (id, secret_hash, user_id, username, name, created_at, expires_at, last_used_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                crypto.randomUUID(),
                tokenHash,
                'user789',
                'bob_smith',
                'My Key',
                new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
                new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // Expired 1 hour ago
                null
            ).run();

            const result = await authenticateBearerToken(env as any, token);
            expect(result).toBeNull();
        });

        it('returns null if token is completely invalid', async () => {
            const token = 'invalid-token';
            const result = await authenticateBearerToken(env as any, token);
            expect(result).toBeNull();
        });
    });
});
