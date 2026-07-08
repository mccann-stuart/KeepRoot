import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchBookmarkIds } from '../../src/storage/search';

describe('search storage', () => {
    describe('searchBookmarkIds', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('returns an empty array if query is empty', async () => {
            const results = await searchBookmarkIds(env as any, 'user-1', { query: '   ' });
            expect(results).toEqual([]);
        });

        it('triggers fallback text search if FTS and Vector return empty results', async () => {
            const batchSpy = vi.spyOn(env.KEEPROOT_DB, 'batch').mockImplementation(async () => {
                return [
                    { results: [{ id: 'b1', domain: 'example.com', source_id: null, status: 'saved' }] },
                    { results: [{ bookmark_id: 'b1', name: 'tag1' }] }
                ] as any;
            });

            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query) => {
                if (query.includes('item_search_fts MATCH')) {
                    return {
                        bind: () => ({
                            all: async () => ({ results: [] })
                        })
                    } as any;
                }
                if (query.includes('item_search_documents')) {
                    return {
                        bind: () => ({
                            all: async () => ({
                                results: [
                                    {
                                        bookmark_id: 'b1',
                                        title: 'My Title With Fallback Match',
                                        notes: 'some notes here',
                                        tags_text: 'tag1 tag2',
                                        excerpt: 'an excerpt',
                                        body_text: 'some body text that does not match'
                                    },
                                    {
                                        bookmark_id: 'b2',
                                        title: 'Something completely different',
                                        notes: null,
                                        tags_text: null,
                                        excerpt: null,
                                        body_text: null
                                    }
                                ]
                            })
                        })
                    } as any;
                }

                return {
                    bind: () => ({
                        all: async () => ({ results: [] }),
                        first: async () => null,
                    })
                } as any;
            });

            if (env.KEEPROOT_VECTOR_INDEX) {
                vi.spyOn(env.KEEPROOT_VECTOR_INDEX, 'query').mockImplementation(async () => {
                    return { matches: [] } as any;
                });
            }

            const results = await searchBookmarkIds(env as any, 'user-1', { query: 'fallback' });

            // Assert that the fallback query was executed
            const prepareCalls = prepareSpy.mock.calls.map(call => call[0]);
            const fallbackQueryCalled = prepareCalls.some(query => query.includes('item_search_documents'));
            expect(fallbackQueryCalled).toBe(true);

            // Assert that the results are populated correctly based on mocked candidates and cosine similarity
            expect(results).toHaveLength(1);
            expect(results[0].id).toBe('b1');
            expect(results[0].matchReason).toBe('semantic');
            expect(results[0].score).toBeGreaterThan(0);
        });

        it('does not trigger fallback if Vector search populates semanticScores', async () => {
            const batchSpy = vi.spyOn(env.KEEPROOT_DB, 'batch').mockImplementation(async () => {
                return [
                    { results: [{ id: 'b1', domain: 'example.com', source_id: null, status: 'saved' }] },
                    { results: [] }
                ] as any;
            });

            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query) => {
                if (query.includes('item_search_fts MATCH')) {
                    return {
                        bind: () => ({
                            all: async () => ({ results: [] })
                        })
                    } as any;
                }

                return {
                    bind: () => ({
                        all: async () => ({ results: [] }),
                        first: async () => null,
                    })
                } as any;
            });

            const originalAi = env.AI;
            // The AI service is expected to return vector embeddings so Vector search can proceed
            (env as any).AI = {
                run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] })
            };

            const originalIndex = env.KEEPROOT_VECTOR_INDEX;
            (env as any).KEEPROOT_VECTOR_INDEX = {
                query: vi.fn().mockResolvedValue({
                    matches: [{
                        id: 'b1',
                        score: 0.9,
                        metadata: {
                            domain: 'example.com',
                            sourceId: null,
                            status: 'saved',
                            tags: []
                        }
                    }]
                })
            };

            const results = await searchBookmarkIds(env as any, 'user-1', { query: 'fallback', status: 'saved' });

            // Assert that the fallback query was NOT executed because semanticScores was populated
            const prepareCalls = prepareSpy.mock.calls.map(call => call[0]);
            const fallbackQueryCalled = prepareCalls.some(query => query.includes('item_search_documents'));
            expect(fallbackQueryCalled).toBe(false);

            expect(results).toHaveLength(1);
            expect(results[0].id).toBe('b1');
            expect(results[0].matchReason).toBe('semantic');
            expect(results[0].score).toBeGreaterThan(0);

            (env as any).AI = originalAi;
            (env as any).KEEPROOT_VECTOR_INDEX = originalIndex;
        });
    });
});
