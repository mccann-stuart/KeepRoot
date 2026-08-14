/* Browser crawls run as durable Workflow instances rather than self-re-enqueuing queue
   messages. The instance id is the authoritative liveness signal for a run, replacing the
   lease clock that reaped crawls legitimately running longer than ten minutes. */
ALTER TABLE source_runs ADD COLUMN workflow_instance_id TEXT;

/* Conditional-GET validators for the source's root sitemap. A 304 lets a poll skip fetching,
   parsing and re-hashing the whole sitemap, which dominated per-run cost on large sites. */
ALTER TABLE sources ADD COLUMN sitemap_etag TEXT;

ALTER TABLE sources ADD COLUMN sitemap_last_modified TEXT;

ALTER TABLE sources ADD COLUMN sitemap_fetched_at TEXT;

CREATE INDEX IF NOT EXISTS idx_source_runs_workflow
	ON source_runs(workflow_instance_id)
	WHERE workflow_instance_id IS NOT NULL;
