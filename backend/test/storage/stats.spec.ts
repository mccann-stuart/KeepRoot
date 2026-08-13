import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUsageStats, recordToolEvent } from '../../src/storage/stats';

describe('stats storage', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe('recordToolEvent', () => {
        it('should correctly bind and run the insert query', async () => {
            const runMock = vi.fn().mockResolvedValue(undefined);
            const bindMock = vi.fn().mockReturnValue({ run: runMock });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindMock } as any);

            await recordToolEvent(env as any, {
                durationMs: 1500.5,
                errorText: 'Some error',
                status: 'error',
                toolName: 'my-tool',
                userId: 'user-1'
            });

            expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO tool_events'));
            expect(bindMock).toHaveBeenCalledWith(
                expect.any(String),
                'user-1',
                'my-tool',
                'error',
                1500,
                'Some error',
                expect.any(String)
            );
            expect(runMock).toHaveBeenCalled();
        });

        it('should handle missing errorText and format duration correctly', async () => {
            const runMock = vi.fn().mockResolvedValue(undefined);
            const bindMock = vi.fn().mockReturnValue({ run: runMock });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindMock } as any);

            await recordToolEvent(env as any, {
                durationMs: -500,
                status: 'success',
                toolName: 'other-tool',
                userId: 'user-2'
            });

            expect(bindMock).toHaveBeenCalledWith(
                expect.any(String),
                'user-2',
                'other-tool',
                'success',
                0,
                null,
                expect.any(String)
            );
            expect(runMock).toHaveBeenCalled();
        });
    });

    describe('getUsageStats', () => {
        it('should return populated data correctly', async () => {
            const batchSpy = vi.spyOn(env.KEEPROOT_DB, 'batch').mockResolvedValue([
                { results: [{ count: 10 }] }, // totalItemsResult
                { results: [{ count: 2 }] }, // pendingInboxResult
                { results: [{ count: 5 }] }, // totalSourcesResult
                { results: [ // itemsByStatusResult
                    { kind: 'active', count: 8 },
                    { kind: 'archived', count: 2 }
                ] },
                { results: [ // sourcesByKindResult
                    { kind: 'rss', count: 3 },
                    { kind: 'newsletter', count: 2 }
                ] },
                { results: [ // toolUsageResult
                    { tool_name: 'parser', status: 'success', count: 10 },
                    { tool_name: 'summarizer', status: 'error', count: 1 }
                ] },
                { results: [ // sourceHealthResult
                    { id: 'src-1', kind: 'rss', name: 'Blog', status: 'active', last_polled_at: '2023-01-01', last_success_at: '2023-01-01', last_error: null, next_poll_at: '2026-08-06T14:00:00.000Z', poll_interval_minutes: 120 }
                ] },
				{ results: [{ count: 4 }] },
				{ results: [{ source_id: 'src-1', rank: 1, status: 'success', discovered_count: 10, processed_count: 10, created_count: 6, refreshed_count: 4, unchanged_count: 0, error_count: 0, examined_count: 0, skipped_count: 0, upstream_error_count: 0, saturated: 0 }] },
				{ results: [{ count: 0, oldest_queued_at: null }] },
            ] as any);

            const result = await getUsageStats(env as any, 'user-1');

            expect(batchSpy).toHaveBeenCalledTimes(1);
            expect(batchSpy.mock.calls[0][0]).toHaveLength(10);

			expect(result).toEqual(expect.objectContaining({
				ingestion: expect.objectContaining({ dailyRefreshes: 4, health: 'red' }),
                inbox: {
                    pending: 2
                },
                items: {
                    byStatus: { active: 8, archived: 2 },
                    total: 10
                },
                recentToolUsage: [
                    { count: 10, status: 'success', toolName: 'parser' },
                    { count: 1, status: 'error', toolName: 'summarizer' }
                ],
                sourceHealth: [
                    {
						id: 'src-1',
						createdCount: 6,
						discoveredCount: 10,
						errorCount: 0,
						examinedCount: 0,
						health: 'red',
                        kind: 'rss',
                        lastPolledAt: '2023-01-01',
                        lastSuccessAt: '2023-01-01',
                        name: 'Blog',
						nextPollAt: '2026-08-06T14:00:00.000Z',
						pollIntervalMinutes: 120,
						processedCount: 10,
						refreshedCount: 4,
						saturated: false,
						skippedCount: 0,
						status: 'success',
						unchangedCount: 0,
						upstreamErrorCount: 0,
                    }
                ],
                sources: {
                    byKind: { rss: 3, newsletter: 2 },
                    total: 5
                }
			}));
        });

        it('should handle empty states gracefully', async () => {
            const batchSpy = vi.spyOn(env.KEEPROOT_DB, 'batch').mockResolvedValue([
                { results: [] }, // totalItemsResult
                { results: [] }, // pendingInboxResult
                { results: [] }, // totalSourcesResult
                { results: [] }, // itemsByStatusResult
                { results: [] }, // sourcesByKindResult
                { results: [] }, // toolUsageResult
				{ results: [] }, // sourceHealthResult
				{ results: [{ count: 0 }] },
				{ results: [] },
				{ results: [{ count: 0, oldest_queued_at: null }] },
            ] as any);

            const result = await getUsageStats(env as any, 'user-1');

            expect(batchSpy).toHaveBeenCalledTimes(1);

			expect(result).toEqual(expect.objectContaining({
				ingestion: expect.objectContaining({ dailyRefreshes: 0, health: 'green' }),
                inbox: {
                    pending: 0
                },
                items: {
                    byStatus: {},
                    total: 0
                },
                recentToolUsage: [],
                sourceHealth: [],
                sources: {
                    byKind: {},
                    total: 0
                }
			}));
        });
    });
});
