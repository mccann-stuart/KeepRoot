import { syncSource } from '../ingest/source-sync';
import { enqueueSourceRun } from '../ingest/source-queue';
import type { SourceKind, StorageEnv } from '../storage/shared';

export async function maybeQueueSourceSync(
	env: StorageEnv,
	source: Record<string, unknown>,
): Promise<void> {
	const pollUrl = typeof source.pollUrl === 'string' ? source.pollUrl : null;
	const kind = typeof source.kind === 'string' ? source.kind as SourceKind : null;
	const id = typeof source.id === 'string' ? source.id : null;
	const name = typeof source.name === 'string' ? source.name : undefined;
	const userId = typeof (source as { userId?: unknown }).userId === 'string' ? (source as { userId: string }).userId : null;

	if (!id || !kind || !pollUrl || !userId) {
		return;
	}

	if (env.SOURCE_QUEUE) {
		await enqueueSourceRun(env, id);
		return;
	}

	await syncSource(env, {
		id,
		kind,
		name,
		pollUrl,
		userId,
	});
}
