import { syncSource, type SourceSyncResult } from './source-sync';
import { advanceBrowserSourceRun, BrowserRunCrawlError } from './browser-run';
import { calculateNextPollAt, clampSourcePollIntervalMinutes, DEFAULT_POLL_INTERVAL_MINUTES } from './feed-schedule';
import { listDuePollableSources } from '../storage/sources';
import type { SourceKind, StorageEnv } from '../storage/shared';

const SOURCE_LEASE_MS = 10 * 60 * 1_000;
const TERMINAL_ATTEMPT = 6;

export interface SourceQueueJob {
	runId: string;
	sourceId: string;
}

export interface EnqueueSourceRunResult {
	queued: boolean;
	runId: string;
}

interface PollableSourceRunRow {
	attempt_count: number;
	http_etag: string | null;
	http_last_modified: string | null;
	initial_crawl: number;
	kind: SourceKind;
	last_success_at: string | null;
	name: string;
	poll_interval_minutes: number;
	finished_at: string | null;
	poll_url: string | null;
	run_status: string;
	source_status: string;
	upstream_cursor: string | null;
	upstream_job_id: string | null;
	upstream_phase: string | null;
	upstream_started_at: string | null;
	user_id: string;
	validator_url: string | null;
}

interface ExpiredSourceRunRow {
	kind: SourceKind;
	poll_interval_minutes: number;
	run_id: string;
	source_id: string;
}

export class SourceLeaseBusyError extends Error {
	constructor() {
		super('Source is already being processed');
		this.name = 'SourceLeaseBusyError';
	}
}

function retryableSourceError(error: unknown): boolean {
	if (error instanceof BrowserRunCrawlError) {
		return error.retryable;
	}
	if (error instanceof TypeError) {
		return true;
	}
	const message = error instanceof Error ? error.message : String(error);
	const status = /\((\d{3})\)/.exec(message)?.[1];
	return status === '408' || status === '429' || Boolean(status && Number(status) >= 500);
}

function sourceRunLog(event: string, fields: Record<string, boolean | number | string>): void {
	console.log(JSON.stringify({ event, ...fields }));
}

function failureNextPollAt(now: string, sourceKind: SourceKind, storedIntervalMinutes: number): string {
	return calculateNextPollAt(
		new Date(now),
		Math.max(DEFAULT_POLL_INTERVAL_MINUTES, clampSourcePollIntervalMinutes(sourceKind, storedIntervalMinutes)),
	);
}

async function recoverExpiredSourceRuns(env: StorageEnv, now: string, sourceId?: string): Promise<number> {
	const expired = await env.KEEPROOT_DB.prepare(
		`SELECT s.id AS source_id, s.active_run_id AS run_id, s.kind, s.poll_interval_minutes
		FROM sources s
		JOIN source_runs r ON r.id = s.active_run_id AND r.source_id = s.id
		WHERE s.active_run_id IS NOT NULL AND s.lease_expires_at IS NOT NULL
			AND s.lease_expires_at <= ? AND r.finished_at IS NULL
			AND r.status IN ('queued', 'running', 'waiting', 'retrying', 'partial')
			AND (? IS NULL OR s.id = ?)`,
	).bind(now, sourceId ?? null, sourceId ?? null).all<ExpiredSourceRunRow>();
	const errorText = 'Source run lease expired before completion';
	let recoveredCount = 0;
	for (const row of expired.results) {
		const nextPollAt = failureNextPollAt(now, row.kind, row.poll_interval_minutes);
		const results = await env.KEEPROOT_DB.batch([
			env.KEEPROOT_DB.prepare(
				`UPDATE source_runs SET status = 'error', error_count = error_count + 1,
					error_text = ?, finished_at = ?,
					duration_ms = CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER),
					lease_expires_at = NULL
				WHERE id = ? AND source_id = ? AND finished_at IS NULL
					AND EXISTS (SELECT 1 FROM sources
						WHERE id = ? AND active_run_id = ? AND lease_expires_at <= ?)`,
			).bind(errorText, now, now, row.run_id, row.source_id, row.source_id, row.run_id, now),
			env.KEEPROOT_DB.prepare(
				`UPDATE sources SET last_polled_at = ?, last_error = ?, next_poll_at = ?,
					active_run_id = NULL, lease_expires_at = NULL, updated_at = ?
				WHERE id = ? AND active_run_id = ? AND lease_expires_at <= ?`,
			).bind(now, errorText, nextPollAt, now, row.source_id, row.run_id, now),
		]);
		if ((results[1]?.meta.changes ?? 0) > 0) {
			recoveredCount += 1;
			sourceRunLog('source_run_recovered', {
				reason: 'expired_lease',
				runId: row.run_id,
				sourceId: row.source_id,
			});
		}
	}
	return recoveredCount;
}

async function sendSourceJobs(queue: Queue<unknown>, jobs: SourceQueueJob[]): Promise<void> {
	for (let offset = 0; offset < jobs.length; offset += 100) {
		await queue.sendBatch(jobs.slice(offset, offset + 100).map((body) => ({ body })));
	}
}

export async function dispatchScheduledSourceRuns(
	env: StorageEnv,
	scheduledTime: number,
): Promise<{ queuedCount: number; sourceCount: number }> {
	if (!env.SOURCE_QUEUE) {
		throw new Error('SOURCE_QUEUE binding is required for scheduled source crawling');
	}

	const startedAt = Date.now();
	const dueAt = new Date(scheduledTime).toISOString();
	const recoveredCount = await recoverExpiredSourceRuns(env, dueAt);
	const sources = await listDuePollableSources(env, dueAt);
	const runIds = sources.map(() => crypto.randomUUID());
	const inserts = sources.map((source, index) => env.KEEPROOT_DB.prepare(
		`INSERT OR IGNORE INTO source_runs
		(id, source_id, run_type, status, dispatch_key, queued_at, started_at)
		VALUES (?, ?, 'poll', 'queued', ?, ?, ?)`,
	).bind(
		runIds[index],
		source.id,
		`cron:${scheduledTime}:${source.id}`,
		new Date(scheduledTime).toISOString(),
		new Date(scheduledTime).toISOString(),
	));
	if (inserts.length) {
		await env.KEEPROOT_DB.batch(inserts);
	}
	const dispatchKeys = sources.map((source) => `cron:${scheduledTime}:${source.id}`);
	const dispatchedRuns = dispatchKeys.length
		? await env.KEEPROOT_DB.prepare(
			`SELECT id, source_id FROM source_runs
			WHERE dispatch_key IN (SELECT value FROM json_each(?))`,
		).bind(JSON.stringify(dispatchKeys)).all<{ id: string; source_id: string }>()
		: { results: [] };
	const runBySource = new Map(dispatchedRuns.results.map((run) => [run.source_id, run.id]));
	const jobs = sources.flatMap((source) => {
		const runId = runBySource.get(source.id);
		return runId ? [{ runId, sourceId: source.id }] : [];
	});
	await sendSourceJobs(env.SOURCE_QUEUE, jobs);

	sourceRunLog('source_cron_summary', {
		durationMs: Date.now() - startedAt,
		queuedCount: jobs.length,
		recoveredCount,
		sourceCount: sources.length,
	});
	return { queuedCount: jobs.length, sourceCount: sources.length };
}

export async function enqueueSourceRun(
	env: StorageEnv,
	sourceId: string,
	runType = 'manual',
): Promise<EnqueueSourceRunResult> {
	if (!env.SOURCE_QUEUE) {
		throw new Error('SOURCE_QUEUE binding is required for source crawling');
	}
	const runId = crypto.randomUUID();
	const now = new Date();
	const queuedAt = now.toISOString();
	const leaseExpiresAt = new Date(now.getTime() + SOURCE_LEASE_MS).toISOString();
	await recoverExpiredSourceRuns(env, queuedAt, sourceId);
	const reservation = await env.KEEPROOT_DB.prepare(
		`UPDATE sources SET active_run_id = ?, lease_expires_at = ?
		WHERE id = ? AND (active_run_id IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)`,
	).bind(runId, leaseExpiresAt, sourceId, queuedAt).run();
	if (!reservation.meta.changes) {
		const active = await env.KEEPROOT_DB.prepare(
			`SELECT active_run_id FROM sources
			WHERE id = ? AND active_run_id IS NOT NULL AND lease_expires_at > ?
			LIMIT 1`,
		).bind(sourceId, queuedAt).first<{ active_run_id: string }>();
		if (!active?.active_run_id) {
			throw new Error(`Source "${sourceId}" could not reserve a crawl run`);
		}
		sourceRunLog('source_run_coalesced', {
			activeRunId: active.active_run_id,
			requestedRunId: runId,
			sourceId,
		});
		return { queued: false, runId: active.active_run_id };
	}

	try {
		await env.KEEPROOT_DB.prepare(
			`INSERT INTO source_runs
			(id, source_id, run_type, status, dispatch_key, queued_at, started_at, lease_expires_at)
			VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`,
		)
			.bind(runId, sourceId, runType, `${runType}:${runId}`, queuedAt, queuedAt, leaseExpiresAt)
			.run();
		await env.SOURCE_QUEUE.send({ runId, sourceId } satisfies SourceQueueJob);
	} catch (error) {
		const errorText = error instanceof Error ? error.message.slice(0, 500) : 'Unknown source queue error';
		await env.KEEPROOT_DB.batch([
			env.KEEPROOT_DB.prepare(
				`UPDATE source_runs SET status = 'error', error_count = error_count + 1,
					error_text = ?, finished_at = ?, lease_expires_at = NULL
				WHERE id = ? AND source_id = ?`,
			).bind(`Failed to enqueue source run: ${errorText}`, queuedAt, runId, sourceId),
			env.KEEPROOT_DB.prepare(
				`UPDATE sources SET active_run_id = NULL, lease_expires_at = NULL
				WHERE id = ? AND active_run_id = ?`,
			).bind(sourceId, runId),
		]);
		throw error;
	}
	sourceRunLog('source_run_queued', { runId, sourceId });
	return { queued: true, runId };
}

async function loadSourceRun(env: StorageEnv, job: SourceQueueJob): Promise<PollableSourceRunRow | null> {
	return env.KEEPROOT_DB.prepare(
		`SELECT s.user_id, s.kind, s.name, s.poll_url, s.status AS source_status,
			s.validator_url, s.http_etag, s.http_last_modified, s.poll_interval_minutes,
			s.last_success_at, r.status AS run_status, r.attempt_count, r.finished_at,
			r.upstream_job_id, r.upstream_phase, r.upstream_cursor, r.upstream_started_at,
			r.initial_crawl
		FROM source_runs r
		JOIN sources s ON s.id = r.source_id
		WHERE r.id = ? AND r.source_id = ?
		LIMIT 1`,
	)
		.bind(job.runId, job.sourceId)
		.first<PollableSourceRunRow>();
}

async function releaseLease(env: StorageEnv, sourceId: string, runId: string): Promise<void> {
	await env.KEEPROOT_DB.prepare(
		`UPDATE sources SET active_run_id = NULL, lease_expires_at = NULL
		WHERE id = ? AND active_run_id = ?`,
	).bind(sourceId, runId).run();
}

async function acquireLease(env: StorageEnv, sourceId: string, runId: string): Promise<string> {
	const now = new Date();
	const leaseExpiresAt = new Date(now.getTime() + SOURCE_LEASE_MS).toISOString();
	const result = await env.KEEPROOT_DB.prepare(
		`UPDATE sources
		SET active_run_id = ?, lease_expires_at = ?
		WHERE id = ? AND (
			active_run_id IS NULL OR active_run_id = ? OR lease_expires_at < ?
		)`,
	).bind(runId, leaseExpiresAt, sourceId, runId, now.toISOString()).run();
	if (!result.meta.changes) {
		throw new SourceLeaseBusyError();
	}
	return leaseExpiresAt;
}

async function cancelSupersededRuns(env: StorageEnv, sourceId: string, activeRunId: string): Promise<void> {
	const now = new Date().toISOString();
	await env.KEEPROOT_DB.prepare(
		`UPDATE source_runs
		SET status = 'cancelled', finished_at = ?, error_text = ?, lease_expires_at = NULL,
			duration_ms = CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)
		WHERE source_id = ? AND id != ? AND finished_at IS NULL
			AND status IN ('queued', 'running', 'waiting', 'retrying', 'partial')`,
	).bind(now, `Superseded by active source run ${activeRunId}`, now, sourceId, activeRunId).run();
}

async function cancelLeaseCollision(env: StorageEnv, job: SourceQueueJob): Promise<void> {
	const now = new Date().toISOString();
	await env.KEEPROOT_DB.prepare(
		`UPDATE source_runs
		SET status = 'cancelled', finished_at = ?, error_text = ?, lease_expires_at = NULL,
			duration_ms = CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)
		WHERE id = ? AND source_id = ? AND finished_at IS NULL`,
	).bind(now, 'Superseded by another active source run', now, job.runId, job.sourceId).run();
}

async function finishWithoutFetch(env: StorageEnv, job: SourceQueueJob): Promise<void> {
	const now = new Date().toISOString();
	await env.KEEPROOT_DB.prepare(
		`UPDATE source_runs
		SET status = 'success', finished_at = ?, duration_ms = CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)
		WHERE id = ? AND source_id = ? AND status NOT IN ('success', 'error')`,
	).bind(now, now, job.runId, job.sourceId).run();
}

async function recordResult(
	env: StorageEnv,
	job: SourceQueueJob,
	result: SourceSyncResult,
	storedIntervalMinutes: number,
	sourceKind: SourceKind,
	attempts: number,
	durationMs: number,
): Promise<void> {
	const now = new Date().toISOString();
	const intervalMinutes = result.recommendedIntervalMinutes === null
		? clampSourcePollIntervalMinutes(sourceKind, storedIntervalMinutes)
		: clampSourcePollIntervalMinutes(sourceKind, result.recommendedIntervalMinutes);
	const nextPollAt = calculateNextPollAt(new Date(now), intervalMinutes);
	const status = result.needsContinuation ? 'partial' : result.errorCount > 0 ? 'partial' : 'success';
	const runUpdate = result.countsPersisted
		? env.KEEPROOT_DB.prepare(
			`UPDATE source_runs SET status = ?, discovered_count = ?, examined_count = ?,
				processed_count = ?, saved_count = ?, created_count = ?, refreshed_count = ?,
				unchanged_count = ?, skipped_count = ?, error_count = ?,
				saturated = ?, not_modified = ?, upstream_phase = 'completed', upstream_cursor = NULL, finished_at = ?,
				duration_ms = CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER), lease_expires_at = NULL
			WHERE id = ? AND source_id = ?`,
		).bind(status, result.discoveredCount, result.examinedCount ?? 0, result.processedCount,
			result.savedCount, result.createdCount, result.refreshedCount, result.unchangedCount,
			result.skippedCount ?? 0, result.errorCount, result.saturated ? 1 : 0,
			result.notModified ? 1 : 0, now, now, job.runId, job.sourceId)
		: result.needsContinuation
		? env.KEEPROOT_DB.prepare(
			`UPDATE source_runs SET status = ?, discovered_count = ?,
				processed_count = processed_count + ?, saved_count = saved_count + ?,
				created_count = created_count + ?, refreshed_count = refreshed_count + ?,
				unchanged_count = ?, error_count = error_count + ?, saturated = MAX(saturated, ?),
				not_modified = ?, lease_expires_at = NULL
			WHERE id = ? AND source_id = ?`,
		).bind(status, result.discoveredCount, result.savedCount + result.errorCount,
			result.savedCount, result.createdCount, result.refreshedCount, result.unchangedCount,
			result.errorCount, result.saturated ? 1 : 0, result.notModified ? 1 : 0,
			job.runId, job.sourceId)
		: env.KEEPROOT_DB.prepare(
			`UPDATE source_runs SET status = ?, discovered_count = ?,
				processed_count = ?, saved_count = saved_count + ?, created_count = created_count + ?,
				refreshed_count = refreshed_count + ?, unchanged_count = ?, error_count = error_count + ?,
				saturated = MAX(saturated, ?), not_modified = ?, finished_at = ?,
				duration_ms = CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER), lease_expires_at = NULL
			WHERE id = ? AND source_id = ?`,
		).bind(status, result.discoveredCount, result.processedCount, result.savedCount,
			result.createdCount, result.refreshedCount, result.unchangedCount, result.errorCount,
			result.saturated ? 1 : 0, result.notModified ? 1 : 0, now, now,
			job.runId, job.sourceId);

	const sourceUpdate = result.needsContinuation
		? env.KEEPROOT_DB.prepare(
			`UPDATE sources SET last_polled_at = ?, poll_interval_minutes = ?, next_poll_at = ?,
				active_run_id = NULL, lease_expires_at = NULL, updated_at = ?
			WHERE id = ? AND active_run_id = ?`,
		).bind(now, intervalMinutes, nextPollAt, now, job.sourceId, job.runId)
		: env.KEEPROOT_DB.prepare(
			`UPDATE sources SET last_polled_at = ?, last_success_at = ?, last_error = ?,
				validator_url = ?, http_etag = ?, http_last_modified = ?,
				poll_interval_minutes = ?, next_poll_at = ?, active_run_id = NULL,
				lease_expires_at = NULL, updated_at = ?
			WHERE id = ? AND active_run_id = ?`,
		).bind(now, now, result.errorCount ? `${result.errorCount} source processing error(s)` : null,
			result.validatorUrl, result.httpEtag, result.httpLastModified, intervalMinutes, nextPollAt, now,
			job.sourceId, job.runId);
	await env.KEEPROOT_DB.batch([runUpdate, sourceUpdate]);

	if (result.needsContinuation) {
		await env.SOURCE_QUEUE?.send(job, { delaySeconds: 1 });
	}
	sourceRunLog('source_run_summary', {
		attempts,
		createdCount: result.createdCount,
		discoveredCount: result.discoveredCount,
		durationMs,
		errorCount: result.errorCount,
		processedCount: result.processedCount,
		refreshedCount: result.refreshedCount,
		runId: job.runId,
		saturated: result.saturated,
		sourceId: job.sourceId,
		status,
		unchangedCount: result.unchangedCount,
	});
}

async function recordFailure(
	env: StorageEnv,
	job: SourceQueueJob,
	error: unknown,
	storedIntervalMinutes: number,
	sourceKind: SourceKind,
	attempts: number,
	retryable: boolean,
): Promise<void> {
	const now = new Date().toISOString();
	const terminal = !retryable || attempts >= TERMINAL_ATTEMPT;
	const errorText = error instanceof Error ? error.message.slice(0, 500) : 'Unknown source sync error';
	const nextPollAt = failureNextPollAt(now, sourceKind, storedIntervalMinutes);
	await env.KEEPROOT_DB.batch([
		env.KEEPROOT_DB.prepare(
			`UPDATE source_runs SET status = ?, error_count = error_count + 1,
				error_text = ?, finished_at = ?, duration_ms = CASE WHEN ? THEN CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER) ELSE duration_ms END,
				lease_expires_at = NULL
			WHERE id = ? AND source_id = ?`,
		).bind(terminal ? 'error' : 'retrying', errorText, terminal ? now : null,
			terminal ? 1 : 0, now, job.runId, job.sourceId),
		env.KEEPROOT_DB.prepare(
			`UPDATE sources SET last_polled_at = ?, last_error = ?, next_poll_at = ?, active_run_id = NULL,
				lease_expires_at = NULL, updated_at = ?
			WHERE id = ? AND active_run_id = ?`,
		).bind(now, terminal ? errorText : null, nextPollAt, now, job.sourceId, job.runId),
	]);
}

async function finaliseExhaustedSourceRun(
	env: StorageEnv,
	job: SourceQueueJob,
	source: PollableSourceRunRow,
	attempts: number,
): Promise<void> {
	const now = new Date().toISOString();
	const persistedAttemptCount = Math.max(attempts, source.attempt_count);
	const errorText = `Source queue exhausted after ${attempts} delivery attempts without completing`;
	const nextPollAt = failureNextPollAt(now, source.kind, source.poll_interval_minutes);
	await env.KEEPROOT_DB.batch([
		env.KEEPROOT_DB.prepare(
			`UPDATE source_runs SET status = 'error', attempt_count = MAX(attempt_count, ?),
				error_count = error_count + 1, error_text = ?, finished_at = ?,
				duration_ms = CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER),
				lease_expires_at = NULL
			WHERE id = ? AND source_id = ? AND finished_at IS NULL`,
		).bind(persistedAttemptCount, errorText, now, now, job.runId, job.sourceId),
		env.KEEPROOT_DB.prepare(
			`UPDATE sources SET last_polled_at = ?, last_error = ?, next_poll_at = ?,
				active_run_id = NULL, lease_expires_at = NULL, updated_at = ?
			WHERE id = ? AND (active_run_id IS NULL OR active_run_id = ?)
				AND EXISTS (SELECT 1 FROM source_runs
					WHERE id = ? AND source_id = ? AND status = 'error' AND error_text = ?)`,
		).bind(now, errorText, nextPollAt, now, job.sourceId, job.runId,
			job.runId, job.sourceId, errorText),
	]);
	sourceRunLog('source_run_summary', {
		attempts,
		createdCount: 0,
		discoveredCount: 0,
		durationMs: 0,
		errorCount: 1,
		processedCount: 0,
		refreshedCount: 0,
		runId: job.runId,
		sourceId: job.sourceId,
		status: 'error',
		unchangedCount: 0,
	});
}

export async function processSourceQueueJob(
	env: StorageEnv,
	job: SourceQueueJob,
	attempts: number,
): Promise<'completed' | 'continued' | 'ignored'> {
	const source = await loadSourceRun(env, job);
	if (!source || source.finished_at || source.run_status === 'success' || source.run_status === 'error') {
		return 'ignored';
	}
	if (source.source_status !== 'active' || !source.poll_url) {
		await finishWithoutFetch(env, job);
		return 'ignored';
	}
	if (attempts >= TERMINAL_ATTEMPT) {
		await finaliseExhaustedSourceRun(env, job, source, attempts);
		return 'completed';
	}

	const startedAt = Date.now();
	try {
		const leaseExpiresAt = await acquireLease(env, job.sourceId, job.runId);
		await cancelSupersededRuns(env, job.sourceId, job.runId);
		await env.KEEPROOT_DB.prepare(
			`UPDATE source_runs SET status = 'running', attempt_count = attempt_count + 1, lease_expires_at = ?
			WHERE id = ? AND source_id = ?`,
		).bind(leaseExpiresAt, job.runId, job.sourceId).run();
		if (source.kind === 'browser') {
			const step = await advanceBrowserSourceRun(
				env,
				{
					id: job.sourceId,
					lastSuccessAt: source.last_success_at,
					name: source.name,
					pollUrl: source.poll_url,
					userId: source.user_id,
				},
				{
					initialCrawl: Boolean(source.initial_crawl),
					runId: job.runId,
					upstreamCursor: source.upstream_cursor,
					upstreamJobId: source.upstream_job_id,
					upstreamPhase: source.upstream_phase,
					upstreamStartedAt: source.upstream_started_at,
				},
			);
			if (step.status === 'waiting') {
				await env.KEEPROOT_DB.batch([
					env.KEEPROOT_DB.prepare(
						`UPDATE source_runs SET status = 'waiting', lease_expires_at = ?
						WHERE id = ? AND source_id = ?`,
					).bind(leaseExpiresAt, job.runId, job.sourceId),
					env.KEEPROOT_DB.prepare(
						`UPDATE sources SET lease_expires_at = ?
						WHERE id = ? AND active_run_id = ?`,
					).bind(leaseExpiresAt, job.sourceId, job.runId),
				]);
				await env.SOURCE_QUEUE?.send(job, { delaySeconds: step.delaySeconds });
				return 'continued';
			}
			await recordResult(
				env,
				job,
				step.result,
				source.poll_interval_minutes,
				source.kind,
				attempts,
				Date.now() - startedAt,
			);
			return 'completed';
		}

		const result = await syncSource(env, {
			httpEtag: source.http_etag,
			httpLastModified: source.http_last_modified,
			id: job.sourceId,
			kind: source.kind,
			name: source.name,
			pollUrl: source.poll_url,
			userId: source.user_id,
			validatorUrl: source.validator_url,
		}, { recordStandaloneRun: false });
		await recordResult(env, job, result, source.poll_interval_minutes, source.kind, attempts, Date.now() - startedAt);
		return result.needsContinuation ? 'continued' : 'completed';
	} catch (error) {
		if (error instanceof SourceLeaseBusyError) {
			await cancelLeaseCollision(env, job);
			sourceRunLog('source_run_summary', {
				attempts,
				createdCount: 0,
				discoveredCount: 0,
				durationMs: Date.now() - startedAt,
				errorCount: 0,
				processedCount: 0,
				refreshedCount: 0,
				runId: job.runId,
				sourceId: job.sourceId,
				status: 'cancelled',
				unchangedCount: 0,
			});
			return 'ignored';
		}
		const retryable = retryableSourceError(error);
		await recordFailure(env, job, error, source.poll_interval_minutes, source.kind, attempts, retryable);
		await releaseLease(env, job.sourceId, job.runId);
		sourceRunLog('source_run_summary', {
			attempts,
			createdCount: 0,
			discoveredCount: 0,
			durationMs: Date.now() - startedAt,
			errorCount: 1,
			processedCount: 0,
			refreshedCount: 0,
			runId: job.runId,
			sourceId: job.sourceId,
			status: retryable && attempts < TERMINAL_ATTEMPT ? 'retrying' : 'error',
			unchangedCount: 0,
		});
		if (retryable && attempts < TERMINAL_ATTEMPT) {
			throw error;
		}
		return 'completed';
	}
}

export function sourceRetryDelaySeconds(attempts: number, error?: unknown): number {
	if (error instanceof BrowserRunCrawlError && error.retryAfterSeconds !== null) {
		return Math.min(Math.max(1, error.retryAfterSeconds), 12 * 60 * 60);
	}
	return Math.min(15 * (2 ** Math.max(0, attempts - 1)), 15 * 60);
}
