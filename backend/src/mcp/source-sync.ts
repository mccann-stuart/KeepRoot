import { syncSource } from '../ingest/source-sync';
import type { IngestJob } from '../ingest/jobs';
import type { SourceKind, StorageEnv } from '../storage/shared';

export async function maybeQueueSourceSync(
	env: StorageEnv,
	source: Record<string, unknown>,
): Promise<void> {
	const pollUrl = typeof source.pollUrl === 'string' ? source.pollUrl : null;
	const kind = typeof source.kind === 'string' ? source.kind as SourceKind : null;
	const id = typeof source.id === 'string' ? source.id : null;
	const userId = typeof (source as { userId?: unknown }).userId === 'string' ? (source as { userId: string }).userId : null;

	if (!id || !kind || !pollUrl || !userId) {
		return;
	}

	if (env.INGEST_QUEUE) {
		const job: IngestJob = {
			kind: 'sync_source',
			payload: {
				id,
				kind,
				pollUrl,
				userId,
			},
		};
		await env.INGEST_QUEUE.send(job);
		return;
	}

	await syncSource(env, {
		id,
		kind,
		pollUrl,
		userId,
	});
}
