import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import {
	runBrowserCrawl,
	type BrowserCrawlParams,
	type BrowserSourceInput,
	type CrawlStep,
} from './browser-run';
import { recordSourceRunFailure, recordSourceRunResult } from './source-queue';
import type { SourceKind, StorageEnv } from '../storage/shared';

interface BrowserRunRow {
	kind: SourceKind;
	last_success_at: string | null;
	name: string;
	poll_interval_minutes: number;
	poll_url: string | null;
	finished_at: string | null;
	run_status: string;
	sitemap_etag: string | null;
	sitemap_last_modified: string | null;
	source_status: string;
	user_id: string;
}

async function loadBrowserRun(
	env: StorageEnv,
	params: BrowserCrawlParams,
): Promise<BrowserRunRow | null> {
	return env.KEEPROOT_DB.prepare(
		`SELECT s.user_id, s.kind, s.name, s.poll_url, s.status AS source_status,
			s.poll_interval_minutes, s.last_success_at, s.sitemap_etag, s.sitemap_last_modified,
			r.status AS run_status, r.finished_at
		FROM source_runs r
		JOIN sources s ON s.id = r.source_id
		WHERE r.id = ? AND r.source_id = ?
		LIMIT 1`,
	).bind(params.runId, params.sourceId).first<BrowserRunRow>();
}

/**
 * Drives one browser source crawl and records its terminal state.
 *
 * Split out from the entrypoint class so tests can supply a fake step without the Workflows
 * runtime. Failures are recorded here rather than rethrown so the run reaches a terminal D1
 * status; a queue delivery that ends without one leaves the dashboard inventing work that no
 * longer exists.
 */
export async function executeBrowserCrawlRun(
	env: StorageEnv,
	params: BrowserCrawlParams,
	step: CrawlStep,
): Promise<'completed' | 'ignored'> {
	const row = await loadBrowserRun(env, params);
	if (!row || row.finished_at || row.run_status === 'success' || row.run_status === 'error') {
		return 'ignored';
	}
	if (row.source_status !== 'active' || !row.poll_url) {
		await env.KEEPROOT_DB.prepare(
			`UPDATE source_runs
			SET status = 'success', finished_at = ?,
				duration_ms = CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)
			WHERE id = ? AND source_id = ? AND status NOT IN ('success', 'error')`,
		).bind(new Date().toISOString(), new Date().toISOString(), params.runId, params.sourceId).run();
		return 'ignored';
	}

	const source: BrowserSourceInput = {
		id: params.sourceId,
		lastSuccessAt: row.last_success_at,
		name: row.name,
		pollUrl: row.poll_url,
		sitemapValidators: { etag: row.sitemap_etag, lastModified: row.sitemap_last_modified },
		userId: row.user_id,
	};

	const startedAt = Date.now();
	try {
		const result = await runBrowserCrawl(env, source, params.runId, step);
		await recordSourceRunResult(
			env,
			params,
			result,
			row.poll_interval_minutes,
			row.kind,
			1,
			Date.now() - startedAt,
		);
		return 'completed';
	} catch (error) {
		// Step retries have already been exhausted by the time the error surfaces here.
		await recordSourceRunFailure(env, params, error, row.poll_interval_minutes, row.kind, 1, false);
		// KeepRoot has its terminal failure state; rethrow so Cloudflare also reports the
		// Workflow instance as errored instead of green after a step exhausted its retries.
		throw error;
	}
}

export class BrowserSourceCrawlWorkflow extends WorkflowEntrypoint<StorageEnv, BrowserCrawlParams> {
	async run(event: WorkflowEvent<BrowserCrawlParams>, step: WorkflowStep): Promise<void> {
		await executeBrowserCrawlRun(this.env, event.payload, step as CrawlStep);
	}
}
