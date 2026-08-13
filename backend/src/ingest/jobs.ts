import { syncSource } from './source-sync';
import { saveItemFromUrl } from './save-url';
import type { StorageEnv } from '../storage/shared';

export type IngestJob =
	| {
		kind: 'save_url';
		payload: {
			captureScreenshot?: boolean;
			notes?: string;
			render?: boolean;
			status?: string;
			tags?: string[];
			title?: string;
			url: string;
			userId: string;
			username: string;
		};
	}
	| {
		kind: 'sync_source';
		payload: {
			id: string;
			kind: 'browser' | 'rss' | 'youtube' | 'x' | 'email';
			name?: string;
			pollUrl: string;
			userId: string;
		};
	};

export async function processIngestJob(env: StorageEnv, job: IngestJob): Promise<void> {
	try {
		if (job.kind === 'save_url') {
			await saveItemFromUrl(
				env,
				{
					userId: job.payload.userId,
					username: job.payload.username,
				},
				{
					captureScreenshot: job.payload.captureScreenshot,
					notes: job.payload.notes,
					render: job.payload.render,
					status: job.payload.status,
					tags: job.payload.tags,
					title: job.payload.title,
					url: job.payload.url,
				},
			);
			return;
		}

		if (job.payload.kind === 'browser') {
			throw new Error('Browser sources must be processed through SOURCE_QUEUE');
		}

		await syncSource(env, {
			id: job.payload.id,
			kind: job.payload.kind,
			name: job.payload.name,
			pollUrl: job.payload.pollUrl,
			userId: job.payload.userId,
		});
	} catch (error) {
		console.warn('Failed to process ingest job', error);
		throw error;
	}
}
