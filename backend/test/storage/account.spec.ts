import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearUserData } from '../../src/storage/account';

describe('account storage', () => {
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
});
