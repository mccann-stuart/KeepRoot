import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiKey, listApiKeys, deleteApiKey } from '../../src/storage/api-keys';

describe('api-keys storage', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe('createApiKey', () => {
        it('should generate a valid api key and insert it into the database', async () => {
            const run = vi.fn().mockResolvedValue({});
            const bind = vi.fn().mockReturnValue({ run });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind } as any);

            const user = { userId: 'u1', username: 'testuser' };
            const name = 'My Key';

            const result = await createApiKey(env as any, user, name);

            // Secret should be 24 bytes = 48 hex chars
            expect(result.secret).toMatch(/^[0-9a-f]{48}$/);

            expect(result.metadata.userId).toBe(user.userId);
            expect(result.metadata.username).toBe(user.username);
            expect(result.metadata.name).toBe(name);
            expect(typeof result.metadata.id).toBe('string');
            expect(typeof result.metadata.createdAt).toBe('string');

            expect(prepareSpy).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO api_keys')
            );

            expect(bind).toHaveBeenCalledWith(
                result.metadata.id,
                expect.any(String), // secret hash
                user.userId,
                user.username,
                name,
                result.metadata.createdAt
            );
        });
    });

    describe('listApiKeys', () => {
        it('should return mapped api keys', async () => {
            const all = vi.fn().mockResolvedValue({
                results: [
                    { id: 'k1', name: 'Key 1', created_at: '2023-01-01T00:00:00.000Z' }
                ]
            });
            const bind = vi.fn().mockReturnValue({ all });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind } as any);

            const result = await listApiKeys(env as any, 'u1');

            expect(result).toEqual([
                { id: 'k1', name: 'Key 1', createdAt: '2023-01-01T00:00:00.000Z' }
            ]);
            expect(prepareSpy).toHaveBeenCalledWith(
                expect.stringContaining('SELECT id, name, created_at')
            );
            expect(bind).toHaveBeenCalledWith('u1');
        });
    });

    describe('deleteApiKey', () => {
        it('should return true if a key was deleted', async () => {
            const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
            const bind = vi.fn().mockReturnValue({ run });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind } as any);

            const result = await deleteApiKey(env as any, 'u1', 'k1');

            expect(result).toBe(true);
            expect(prepareSpy).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM api_keys')
            );
            expect(bind).toHaveBeenCalledWith('k1', 'u1');
        });

        it('should return false if no key was deleted', async () => {
            const run = vi.fn().mockResolvedValue({ meta: { changes: 0 } });
            const bind = vi.fn().mockReturnValue({ run });
            vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind } as any);

            const result = await deleteApiKey(env as any, 'u1', 'k1');

            expect(result).toBe(false);
        });
    });
});
