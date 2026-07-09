import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearUserData, ensureAccountSettings, getWhoAmI } from '../../src/storage/account';
import type { AuthenticatedUser } from '../../src/storage/shared';

function createAccountSettingsEnv(overrides: Record<string, string> = {}) {
    const run = vi.fn().mockResolvedValue({});
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const storageEnv = {
        KEEPROOT_DB: { prepare },
        EMAIL_SOURCE_DOMAIN: '',
        ENABLE_X_SOURCES: '0',
        MCP_EMAIL_DOMAIN: '',
        X_SOURCE_BRIDGE_BASE_URL: '',
        ...overrides,
    };

    return { bind, prepare, run, storageEnv };
}

describe('account storage', () => {
    describe('getWhoAmI', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('returns default settings for new user with no db records', async () => {
            const batchSpy = vi.spyOn(env.KEEPROOT_DB, 'batch').mockImplementation(async () => {
                // Return an empty array for the select query to simulate no existing settings
                return [
                    { results: [] }, // insertResult
                    { results: [] }, // selectResult
                ] as any;
            });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare');
            const runSpy = vi.spyOn(Object.getPrototypeOf(env.KEEPROOT_DB.prepare('')), 'run').mockResolvedValue({} as any);

            const user: AuthenticatedUser = {
                userId: 'test-user-id',
                username: 'testuser',
                tokenType: 'webauthn',
                roles: [],
            };

            const result = await getWhoAmI(env as any, user);

            expect(batchSpy).toHaveBeenCalledTimes(1);
            expect(result).toEqual({
                account: {
                    createdAt: null,
                    displayName: 'testuser', // fallbacks to username
                    plan: 'self_hosted',
                    updatedAt: null,
                    userId: 'test-user-id',
                    username: 'testuser',
                },
                features: {
                    email: false,
                    rss: true,
                    x: false,
                    youtube: true,
                },
                limits: {
                    maxItems: null,
                    maxSources: null,
                    maxToolCallsPerDay: null,
                },
                tokenType: 'webauthn',
            });
        });

        it('returns custom settings when they exist in db', async () => {
            const batchSpy = vi.spyOn(env.KEEPROOT_DB, 'batch').mockImplementation(async () => {
                return [
                    { results: [] }, // insertResult
                    {
                        results: [{
                            created_at: '2023-01-01T00:00:00Z',
                            display_name: 'Custom Name',
                            features_json: JSON.stringify({ customFeature: true }),
                            limits_json: JSON.stringify({ maxItems: 100 }),
                            plan_code: 'pro',
                            updated_at: '2023-01-02T00:00:00Z',
                            user_id: 'test-user-id',
                        }],
                    }, // selectResult
                ] as any;
            });

            const user: AuthenticatedUser = {
                userId: 'test-user-id',
                username: 'testuser',
                tokenType: 'webauthn',
                roles: [],
            };

            const result = await getWhoAmI(env as any, user);

            expect(result).toEqual({
                account: {
                    createdAt: '2023-01-01T00:00:00Z',
                    displayName: 'Custom Name',
                    plan: 'pro',
                    updatedAt: '2023-01-02T00:00:00Z',
                    userId: 'test-user-id',
                    username: 'testuser',
                },
                features: { customFeature: true },
                limits: { maxItems: 100 },
                tokenType: 'webauthn',
            });
        });

        it('gracefully handles invalid json in db and falls back to defaults', async () => {
            const batchSpy = vi.spyOn(env.KEEPROOT_DB, 'batch').mockImplementation(async () => {
                return [
                    { results: [] }, // insertResult
                    {
                        results: [{
                            created_at: '2023-01-01T00:00:00Z',
                            display_name: 'Custom Name',
                            features_json: '{invalid-json',
                            limits_json: 'null',
                            plan_code: 'pro',
                            updated_at: '2023-01-02T00:00:00Z',
                            user_id: 'test-user-id',
                        }],
                    }, // selectResult
                ] as any;
            });

            const user: AuthenticatedUser = {
                userId: 'test-user-id',
                username: 'testuser',
                tokenType: 'webauthn',
                roles: [],
            };

            const result = await getWhoAmI(env as any, user);

            expect(result.features).toEqual({
                email: false,
                rss: true,
                x: false,
                youtube: true,
            });
            expect(result.limits).toEqual({
                maxItems: null,
                maxSources: null,
                maxToolCallsPerDay: null,
            });
        });
    });

    describe('clearUserData', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('clears all user data across all tables and associated buckets', async () => {
            const batchSpy = vi.spyOn(env.KEEPROOT_DB, 'batch').mockImplementation(async (stmts) => {
                if (stmts.length === 3) {
                    return [
                        { results: [{ content_ref: 'c1', r2_key: 'k1', html_r2_key: 'h1' }] },
                        { results: [{ r2_key: 'i1' }] },
                        { results: [{ vector_id: 'v1' }] }
                    ] as any;
                }
                return [] as any;
            });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare');
            const deleteIndexSpy = env.KEEPROOT_VECTOR_INDEX ? vi.spyOn(env.KEEPROOT_VECTOR_INDEX, 'deleteByIds').mockImplementation(async () => ({} as any)) : null;

            await clearUserData(env as any, 'test-user-id');

            // The method should call batch 1 time for reads, 1 time for data deletes,
            // and 3 times for unreferenced bucket objects cleanup in deleteUnreferencedBucketObjects
            expect(batchSpy).toHaveBeenCalledTimes(5);
            expect(batchSpy.mock.calls[1][0].length).toBe(13); // the main deletion queries

            expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM item_search_fts WHERE user_id = ?'));
            expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM tool_events WHERE user_id = ?'));
            expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM inbox_entries WHERE user_id = ?'));
            expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM source_runs WHERE source_id IN (SELECT id FROM sources WHERE user_id = ?)'));
            expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM api_keys WHERE user_id = ?'));
            expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM account_settings WHERE user_id = ?'));
            expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM sources WHERE user_id = ?'));
            expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM smart_lists WHERE user_id = ?'));
            expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM lists WHERE user_id = ?'));
            expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM tags WHERE user_id = ?'));
            expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM item_search_documents WHERE user_id = ?'));
            expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM bookmark_embeddings WHERE user_id = ?'));
            expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM bookmarks WHERE user_id = ?'));

            if (deleteIndexSpy) {
                expect(deleteIndexSpy).toHaveBeenCalledWith(['v1']);
            }
        });

        it('handles case with no data gracefully', async () => {
            const batchSpy = vi.spyOn(env.KEEPROOT_DB, 'batch').mockImplementation(async (stmts) => {
                if (stmts.length === 3) {
                    return [
                        { results: [] },
                        { results: [] },
                        { results: [] }
                    ] as any;
                }
                return [] as any;
            });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare');
            const deleteIndexSpy = env.KEEPROOT_VECTOR_INDEX ? vi.spyOn(env.KEEPROOT_VECTOR_INDEX, 'deleteByIds').mockImplementation(async () => ({} as any)) : null;

            await clearUserData(env as any, 'test-user-id');

            // Only 2 batches called since deleteUnreferencedBucketObjects returns early
            expect(batchSpy).toHaveBeenCalledTimes(2);
            expect(batchSpy.mock.calls[1][0].length).toBe(13); // the main deletion queries

            if (deleteIndexSpy) {
                expect(deleteIndexSpy).not.toHaveBeenCalled();
            }
        });
    });

    describe('ensureAccountSettings', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('creates default account settings when they do not exist', async () => {
            const { bind, prepare, run, storageEnv } = createAccountSettingsEnv();

            await ensureAccountSettings(storageEnv as any, { userId: 'user-123', username: 'testuser' });

            expect(prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE INTO account_settings'));
            expect(bind).toHaveBeenCalledWith(
                'user-123',
                'testuser',
                JSON.stringify({ maxItems: null, maxSources: null, maxToolCallsPerDay: null }),
                JSON.stringify({ email: false, rss: true, x: false, youtube: true }),
                expect.any(String),
                expect.any(String),
            );
            expect(run).toHaveBeenCalledTimes(1);
        });

        it('enables email when an email domain is configured', async () => {
            const { bind, storageEnv } = createAccountSettingsEnv({ MCP_EMAIL_DOMAIN: 'example.com' });

            await ensureAccountSettings(storageEnv as any, { userId: 'user-123', username: 'testuser' });

            expect(bind).toHaveBeenCalledWith(
                'user-123',
                'testuser',
                expect.any(String),
                JSON.stringify({ email: true, rss: true, x: false, youtube: true }),
                expect.any(String),
                expect.any(String),
            );
        });

        it('enables X sources when the feature is configured', async () => {
            const { bind, storageEnv } = createAccountSettingsEnv({ ENABLE_X_SOURCES: '1' });

            await ensureAccountSettings(storageEnv as any, { userId: 'user-123', username: 'testuser' });

            expect(bind).toHaveBeenCalledWith(
                'user-123',
                'testuser',
                expect.any(String),
                JSON.stringify({ email: false, rss: true, x: true, youtube: true }),
                expect.any(String),
                expect.any(String),
            );
        });
    });
});
