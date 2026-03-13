import { syncSource } from './source-sync';
import { saveItemFromUrl } from './save-url';
import type { StorageEnv } from '../storage/shared';

export type IngestJob =
	| {
		kind: 'save_url';
		payload: {
			notes?: string;
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
			kind: 'rss' | 'youtube' | 'x' | 'email';
			pollUrl: string;
			userId: string;
		};
	};

export async function processIngestJob(env: StorageEnv, job: IngestJob): Promise<void> {
	if (job.kind === 'save_url') {
		await saveItemFromUrl(
			env,
			{
				userId: job.payload.userId,
				username: job.payload.username,
			},
			{
				notes: job.payload.notes,
				status: job.payload.status,
				tags: job.payload.tags,
				title: job.payload.title,
				url: job.payload.url,
			},
		);
		return;
	}

	await syncSource(env, {
		id: job.payload.id,
		kind: job.payload.kind,
		pollUrl: job.payload.pollUrl,
		userId: job.payload.userId,
	});
}
