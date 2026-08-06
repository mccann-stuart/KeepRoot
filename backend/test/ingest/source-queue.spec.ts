import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncSource, type SourceSyncResult } from '../../src/ingest/source-sync';
import { processSourceQueueJob, sourceRetryDelaySeconds, type SourceQueueJob } from '../../src/ingest/source-queue';

vi.mock('../../src/ingest/source-sync', () => ({ syncSource: vi.fn() }));

function result(overrides: Partial<SourceSyncResult> = {}): SourceSyncResult {
	return {
		createdCount: 200,
		discoveredCount: 201,
		errorCount: 0,
		httpEtag: '"feed-v2"',
		httpLastModified: 'Thu, 06 Aug 2026 12:00:00 GMT',
		needsContinuation: false,
		notModified: false,
		processedCount: 201,
		refreshedCount: 0,
		saturated: false,
		savedCount: 200,
		unchangedCount: 1,
		validatorUrl: 'https://example.com/feed.xml',
		...overrides,
	};
}

describe('source queue processing', () => {
	beforeEach(() => vi.clearAllMocks());

	it('requeues the same minimal job until more than 200 changes are caught up', async () => {
		const send = vi.fn().mockResolvedValue({ metadata: { metrics: { backlogBytes: 0, backlogCount: 0 } } });
		const sourceRow = {
			attempt_count: 0,
			finished_at: null,
			http_etag: null,
			http_last_modified: null,
			kind: 'rss',
			name: 'Feed',
			poll_url: 'https://example.com/feed.xml',
			run_status: 'queued',
			source_status: 'active',
			user_id: 'user-1',
			validator_url: null,
		};
		const statement = {
			all: vi.fn().mockResolvedValue({ results: [] }),
			bind: vi.fn().mockReturnThis(),
			first: vi.fn().mockResolvedValue(sourceRow),
			run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
		};
		const env = {
			KEEPROOT_DB: { batch: vi.fn().mockResolvedValue([]), prepare: vi.fn().mockReturnValue(statement) },
			SOURCE_QUEUE: { send },
		} as any;
		const job: SourceQueueJob = { runId: 'run-1', sourceId: 'source-1' };
		vi.mocked(syncSource)
			.mockResolvedValueOnce(result({ needsContinuation: true, processedCount: 200, unchangedCount: 0 }))
			.mockResolvedValueOnce(result({ createdCount: 1, savedCount: 1 }));

		await expect(processSourceQueueJob(env, job, 1)).resolves.toBe('continued');
		expect(send).toHaveBeenCalledWith(job, { delaySeconds: 1 });
		await expect(processSourceQueueJob(env, job, 1)).resolves.toBe('completed');
		expect(syncSource).toHaveBeenCalledTimes(2);
	});

	it('uses bounded exponential retry delays', () => {
		expect([1, 2, 3, 4, 5, 6].map(sourceRetryDelaySeconds)).toEqual([15, 30, 60, 120, 240, 480]);
	});
});
