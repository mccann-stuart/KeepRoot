import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addSource } from '../../src/storage/sources';

describe('sources storage', () => {
    describe('addSource', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('handles duplicate sources correctly by updating rather than crashing', async () => {
            const userId = 'test-user-id';
            const kind = 'rss';
            const identifier = 'https://example.com/feed';

            const existingId = crypto.randomUUID();

            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query) => {
                return {
                    bind: (...args: any[]) => ({
                        first: async () => {
                            if (query.includes('SELECT id, email_alias')) {
                                return { id: existingId, email_alias: 'save+123@keeproot.com' };
                            }
                            return null;
                        },
                        run: async () => ({ success: true }),
                    }),
                } as any;
            });

            const batchSpy = vi.spyOn(env.KEEPROOT_DB, 'batch').mockImplementation(async (stmts) => {
                return [
                    { results: [{ id: existingId, name: 'My Updated Feed Name', kind, normalized_identifier: identifier, poll_url: identifier, status: 'active' }] },
                    { results: [] }
                ] as any;
            });

            // Mock env.MCP_EMAIL_DOMAIN so it doesn't fail on missing env
            const mockEnv = {
                ...env,
                MCP_EMAIL_DOMAIN: 'keeproot.com',
            } as any;

            // Notice the arguments: mockEnv, { config, identifier, kind, name, userId }
            const duplicateSource = await addSource(mockEnv, {
                userId,
                kind,
                identifier,
                name: 'My Updated Feed Name',
            });

            // The ID should remain the same
            expect(duplicateSource.id).toBe(existingId);

            // The getSourceById batch call returns an array of objects for the batch, one is the result for source. It should have the correct name.
            expect(duplicateSource.name).toBe('My Updated Feed Name');

            expect(prepareSpy).toHaveBeenCalledTimes(4);
            expect(prepareSpy.mock.calls[0][0]).toContain('SELECT id, email_alias');
            expect(prepareSpy.mock.calls[1][0]).toContain('INSERT OR REPLACE INTO sources');

            expect(batchSpy).toHaveBeenCalledTimes(1);
        });
    });
});
