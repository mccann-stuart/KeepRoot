import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addSource, listActivePollableSources } from '../../src/storage/sources';

describe('sources storage', () => {
    describe('addSource', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('reactivates duplicate sources without replacing their stored row', async () => {
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
            expect(prepareSpy.mock.calls[1][0]).toContain('INSERT INTO sources');
            expect(prepareSpy.mock.calls[1][0]).toContain('ON CONFLICT(id) DO UPDATE');
            expect(prepareSpy.mock.calls[1][0]).toContain("status = 'active'");
            expect(prepareSpy.mock.calls[1][0]).not.toContain('INSERT OR REPLACE');

            expect(batchSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('listActivePollableSources', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('returns sources that are active and have a poll_url', async () => {
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query) => {
                return {
                    all: async () => ({
                        results: [
                            {
                                config_json: '{"foo":"bar"}',
                                id: '1',
                                kind: 'rss',
                                last_polled_at: '2023-01-01',
                                name: 'my source',
                                poll_url: 'http://foo',
                                user_id: 'u1'
                            }
                        ]
                    })
                } as any;
            });

            const sources = await listActivePollableSources(env as any);

            expect(prepareSpy).toHaveBeenCalledTimes(1);
            expect(prepareSpy.mock.calls[0][0]).toContain('SELECT id, user_id, kind, name, poll_url, config_json, last_polled_at');
            expect(prepareSpy.mock.calls[0][0]).toContain("WHERE status = 'active' AND poll_url IS NOT NULL");

            expect(sources.length).toBe(1);
            expect(sources[0]).toEqual({
                config: { foo: 'bar' },
                id: '1',
                kind: 'rss',
                lastPolledAt: '2023-01-01',
                name: 'my source',
                pollUrl: 'http://foo',
                userId: 'u1'
            });
        });

        it('returns empty list when no matching sources exist', async () => {
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query) => {
                return {
                    all: async () => ({
                        results: []
                    })
                } as any;
            });

            const sources = await listActivePollableSources(env as any);

            expect(prepareSpy).toHaveBeenCalledTimes(1);
            expect(sources.length).toBe(0);
        });
    });
});
