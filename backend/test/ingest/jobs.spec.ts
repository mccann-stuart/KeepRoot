import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processIngestJob, type IngestJob } from '../../src/ingest/jobs';
import { saveItemFromUrl } from '../../src/ingest/save-url';
import { syncSource } from '../../src/ingest/source-sync';
import type { StorageEnv } from '../../src/storage/shared';

vi.mock('../../src/ingest/save-url', () => ({
    saveItemFromUrl: vi.fn()
}));

vi.mock('../../src/ingest/source-sync', () => ({
    syncSource: vi.fn()
}));

describe('processIngestJob', () => {
    const mockEnv = {} as StorageEnv;

    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleWarnSpy.mockRestore();
    });

    describe('save_url job', () => {
        const mockJob: IngestJob = {
            kind: 'save_url',
            payload: {
                userId: 'user1',
                username: 'johndoe',
                url: 'https://example.com',
                notes: 'test note',
                status: 'unread',
                tags: ['test'],
                title: 'Test Title'
            }
        };

        it('should process successfully', async () => {
            vi.mocked(saveItemFromUrl).mockResolvedValue(undefined as any);

            await expect(processIngestJob(mockEnv, mockJob)).resolves.toBeUndefined();

            expect(saveItemFromUrl).toHaveBeenCalledWith(
                mockEnv,
                { userId: 'user1', username: 'johndoe' },
                {
                    notes: 'test note',
                    status: 'unread',
                    tags: ['test'],
                    title: 'Test Title',
                    url: 'https://example.com'
                }
            );
        });

        it('should catch, log, and re-throw error on failure', async () => {
            const testError = new Error('Save URL failed');
            vi.mocked(saveItemFromUrl).mockRejectedValue(testError);

            await expect(processIngestJob(mockEnv, mockJob)).rejects.toThrow('Save URL failed');
            expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to process ingest job', testError);
        });
    });

    describe('sync_source job', () => {
        const mockJob: IngestJob = {
            kind: 'sync_source',
            payload: {
                id: 'source1',
                kind: 'rss',
                pollUrl: 'https://example.com/feed.xml',
                userId: 'user1'
            }
        };

        it('should process successfully', async () => {
            vi.mocked(syncSource).mockResolvedValue(undefined as any);

            await expect(processIngestJob(mockEnv, mockJob)).resolves.toBeUndefined();

            expect(syncSource).toHaveBeenCalledWith(
                mockEnv,
                {
                    id: 'source1',
                    kind: 'rss',
                    pollUrl: 'https://example.com/feed.xml',
                    userId: 'user1'
                }
            );
        });

        it('should catch, log, and re-throw error on failure', async () => {
            const testError = new Error('Sync source failed');
            vi.mocked(syncSource).mockRejectedValue(testError);

            await expect(processIngestJob(mockEnv, mockJob)).rejects.toThrow('Sync source failed');
            expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to process ingest job', testError);
        });
    });
});
