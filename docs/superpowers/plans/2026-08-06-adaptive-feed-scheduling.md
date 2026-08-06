# Adaptive Feed Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll each feed at a bounded interval learned from its publication history and display publisher timestamps for imported articles.

**Architecture:** A pure scheduling module calculates intervals and due times. D1 persists `poll_interval_minutes` and `next_poll_at`; a ten-minute Cron heartbeat publishes only due sources to the existing Queue, whose result handler advances scheduling state. Feed publication timestamps are stored on bookmarks and preferred by the dashboard.

**Tech Stack:** TypeScript 7, Cloudflare Workers, Queues, D1/SQLite migrations, Vitest 4, vanilla TypeScript dashboard, Wrangler 4.119.0.

## Global Constraints

- Retain the existing queue-first crawler, HTTP validators, source leases, entry fingerprints, continuation jobs, retry policy, safe-URL validation, and inbox deduplication.
- Poll intervals are integer minutes clamped from 10 through 360; the default is 60.
- Use at most the 50 newest valid publisher timestamps.
- Manual and newly-created-source synchronisation remains immediate.
- Bookmark ordering remains unchanged.
- Add no dependency or Cloudflare service.
- Do not run a production migration or deployment.

## File structure

- Create `backend/src/ingest/feed-schedule.ts`: pure date normalisation, interval calculation, and next-due helpers.
- Create `backend/test/ingest/feed-schedule.spec.ts`: literal table-driven scheduling tests.
- Create `backend/migrations/0008_adaptive_feed_scheduling.sql`: additive source schedule and bookmark publication columns plus due index.
- Modify `backend/src/storage/organization.ts`: schema validation and local schema repair for migration 0008.
- Modify `backend/src/storage/sources.ts`: source scheduling fields and due-source query.
- Modify `backend/src/ingest/source-sync.ts`: interval recommendation and publication timestamp propagation/backfill.
- Modify `backend/src/ingest/source-queue.ts`: persist and advance schedule state for queue outcomes.
- Modify `backend/src/storage/shared.ts` and `backend/src/storage/bookmarks.ts`: accept, store, and return `publishedAt`.
- Modify `backend/src/storage/stats.ts`: expose source scheduling state in health output.
- Modify `backend/dashboard/src/main.ts` and `backend/dashboard/src/lib/state.ts`: publication-date rendering and scheduling types.
- Modify focused Worker/dashboard tests, `backend/wrangler.jsonc`, generated Worker types, README, and technical architecture.

---

### Task 1: Pure adaptive interval policy

**Files:**
- Create: `backend/src/ingest/feed-schedule.ts`
- Create: `backend/test/ingest/feed-schedule.spec.ts`

**Interfaces:**
- Produces: `calculateAdaptivePollIntervalMinutes(values: Array<string | null | undefined>): number`
- Produces: `normalizePublishedAt(value: string | null | undefined): string | undefined`
- Produces: `calculateNextPollAt(now: Date, intervalMinutes: number): string`
- Produces: `clampPollIntervalMinutes(value: number | null | undefined): number`

- [ ] **Step 1: Write failing policy tests**

Add literal expectations for these behaviours:

```ts
expect(calculateAdaptivePollIntervalMinutes([])).toBe(60);
expect(calculateAdaptivePollIntervalMinutes(['invalid', 'also invalid'])).toBe(60);
expect(calculateAdaptivePollIntervalMinutes([
  '2026-08-06T12:00:00.000Z',
  '2026-08-06T11:30:00.000Z',
  '2026-08-06T11:00:00.000Z',
])).toBe(10);
expect(calculateAdaptivePollIntervalMinutes([
  '2026-08-06T12:00:00.000Z',
  '2026-08-06T06:00:00.000Z',
  '2026-08-06T00:00:00.000Z',
])).toBe(120);
expect(calculateAdaptivePollIntervalMinutes([
  '2026-08-06T12:00:00.000Z',
  '2026-08-01T12:00:00.000Z',
])).toBe(360);
expect(normalizePublishedAt('Thu, 06 Aug 2026 12:00:00 GMT')).toBe('2026-08-06T12:00:00.000Z');
expect(normalizePublishedAt('not-a-date')).toBeUndefined();
expect(calculateNextPollAt(new Date('2026-08-06T12:00:00.000Z'), 120)).toBe('2026-08-06T14:00:00.000Z');
```

Also prove unsorted inputs produce the same result, duplicate/zero gaps cannot divide by zero, and only the newest 50 values influence the result.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd backend && npx vitest run test/ingest/feed-schedule.spec.ts --config vitest.config.mts`

Expected: FAIL because `feed-schedule.ts` and its exports do not exist.

- [ ] **Step 3: Implement the pure helpers**

Use constants `MIN_POLL_INTERVAL_MINUTES = 10`, `DEFAULT_POLL_INTERVAL_MINUTES = 60`, `MAX_POLL_INTERVAL_MINUTES = 360`, and `MAX_PUBLICATION_SAMPLES = 50`. Parse finite dates, sort descending, retain 50, derive positive gaps, use `gapCount / spanHours` for rate, then apply the approved threshold and one-third-average policy. Return only finite bounded integers.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2 and require exit code 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/ingest/feed-schedule.ts backend/test/ingest/feed-schedule.spec.ts
git commit -m "feat: calculate adaptive feed intervals"
```

### Task 2: Persist scheduling and publication metadata

**Files:**
- Create: `backend/migrations/0008_adaptive_feed_scheduling.sql`
- Modify: `backend/src/storage/organization.ts`
- Modify: `backend/src/storage/sources.ts`
- Modify: `backend/test/storage/organization.spec.ts`
- Modify: `backend/test/storage/sources.spec.ts`
- Modify: `backend/test/index.spec.ts`

**Interfaces:**
- Consumes: `clampPollIntervalMinutes(...)` from Task 1.
- Produces: source rows with `nextPollAt?: string`, `pollIntervalMinutes: number`.
- Produces: `listDuePollableSources(env: StorageEnv, dueAt: string): Promise<PollableSource[]>`.

- [ ] **Step 1: Write failing schema and due-query tests**

Extend schema fixtures to require `sources.next_poll_at`, `sources.poll_interval_minutes`, and `bookmarks.published_at`. Assert the migration can be applied once and creates `idx_sources_due_poll`. Add a source-storage test whose D1 fake returns only due rows and assert the mapped result contains:

```ts
{
  nextPollAt: '2026-08-06T12:00:00.000Z',
  pollIntervalMinutes: 120,
}
```

Assert the prepared SQL filters `status = 'active'`, requires `poll_url IS NOT NULL`, and binds the supplied due timestamp.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd backend && npx vitest run test/storage/organization.spec.ts test/storage/sources.spec.ts test/index.spec.ts --config vitest.config.mts`

Expected: FAIL because migration 0008 and scheduling fields/query are absent.

- [ ] **Step 3: Add the migration and storage mapping**

Migration SQL:

```sql
ALTER TABLE sources ADD COLUMN next_poll_at TEXT;
ALTER TABLE sources ADD COLUMN poll_interval_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE bookmarks ADD COLUMN published_at TEXT;

CREATE INDEX IF NOT EXISTS idx_sources_due_poll
  ON sources(status, next_poll_at)
  WHERE status = 'active' AND poll_url IS NOT NULL;
```

Update organisation validation/repair and source table creation. Extend source selects and mapping. Implement the due query with `(next_poll_at IS NULL OR next_poll_at <= ?)` and deterministic `ORDER BY next_poll_at ASC, created_at ASC`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2 and require exit code 0.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/0008_adaptive_feed_scheduling.sql backend/src/storage/organization.ts backend/src/storage/sources.ts backend/test/storage/organization.spec.ts backend/test/storage/sources.spec.ts backend/test/index.spec.ts
git commit -m "feat: persist adaptive feed schedules"
```

### Task 3: Dispatch due sources and advance schedules

**Files:**
- Modify: `backend/src/ingest/source-sync.ts`
- Modify: `backend/src/ingest/source-queue.ts`
- Modify: `backend/test/ingest/source-sync.spec.ts`
- Modify: `backend/test/ingest/source-queue.spec.ts`
- Modify: `backend/test/index.spec.ts`

**Interfaces:**
- Consumes: Task 1 helpers and Task 2 `listDuePollableSources`.
- Extends: `SourceSyncResult` with `recommendedIntervalMinutes: number | null`.
- Persists: `sources.poll_interval_minutes` and `sources.next_poll_at`.

- [ ] **Step 1: Write failing dispatch/result tests**

Add source-sync tests proving a six-hour publication gap recommends 120 minutes and a `304` returns `recommendedIntervalMinutes: null`. In source-queue tests, make the loaded source contain `poll_interval_minutes: 120` and assert observable D1 bindings produce:

```ts
// Changed feed at 12:00 with a 30-minute recommendation.
poll_interval_minutes = 30
next_poll_at = '2026-08-06T12:30:00.000Z'

// 304 at 12:00 retains 120 minutes.
poll_interval_minutes = 120
next_poll_at = '2026-08-06T14:00:00.000Z'
```

Add cases for continuation and failure advancing `next_poll_at`, and update scheduled-handler integration coverage so only rows returned by `listDuePollableSources` are queued while duplicate scheduled delivery remains idempotent.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd backend && npx vitest run test/ingest/source-sync.spec.ts test/ingest/source-queue.spec.ts test/index.spec.ts --config vitest.config.mts`

Expected: FAIL because results do not recommend intervals and queue result SQL does not persist scheduling state.

- [ ] **Step 3: Implement due dispatch and state transitions**

Make `dispatchScheduledSourceRuns` call `listDuePollableSources(env, new Date(scheduledTime).toISOString())`. Calculate recommendations from parsed entry `publishedAt` values after a `200`. Load the stored interval with each queue job. For every completion/failure timestamp, derive the next due value with `calculateNextPollAt`; retain the existing interval for `304`, use the recommendation for changed feeds, and use at least 60 minutes for failure. Preserve all existing run counters, leases, retry throwing, continuation messages, and structured logs.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2 and require exit code 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/ingest/source-sync.ts backend/src/ingest/source-queue.ts backend/test/ingest/source-sync.spec.ts backend/test/ingest/source-queue.spec.ts backend/test/index.spec.ts
git commit -m "feat: crawl feeds on adaptive schedules"
```

### Task 4: Store and backfill publisher timestamps

**Files:**
- Modify: `backend/src/storage/shared.ts`
- Modify: `backend/src/storage/bookmarks.ts`
- Modify: `backend/src/ingest/source-sync.ts`
- Modify: `backend/test/storage/bookmarks.spec.ts`
- Modify: `backend/test/ingest/source-sync.spec.ts`

**Interfaces:**
- Extends: `BookmarkPayload` with `publishedAt?: string`.
- Extends: bookmark metadata with `publishedAt` when stored.
- Extends: existing source-entry lookups with `published_at`.

- [ ] **Step 1: Write failing persistence/backfill tests**

In bookmark storage tests, save a payload containing `publishedAt: '2026-08-06T09:30:00.000Z'` and assert the inserted/updated bookmark returns that value through metadata. In source-sync tests, assert `saveItemContent` receives the normalised publisher timestamp. Add an unchanged-entry fixture with `published_at: null` and assert the crawler issues a scoped update:

```sql
UPDATE bookmarks
SET published_at = ?
WHERE id = ? AND source_id = ? AND published_at IS NULL
```

The existing unchanged item must not call the expensive content-save path.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd backend && npx vitest run test/storage/bookmarks.spec.ts test/ingest/source-sync.spec.ts --config vitest.config.mts`

Expected: FAIL because `publishedAt` is neither persisted nor returned.

- [ ] **Step 3: Implement storage and lightweight backfill**

Add `published_at` to `BookmarkRow`, all bookmark selects, insert/update bindings, and `makeBookmarkMetadata`. Normalise parsed feed dates through Task 1's helper before passing `publishedAt` to `saveItemContent`. Extend existing-entry lookup rows and batch-update only missing publication timestamps, alongside existing missing-fingerprint baselining, scoped by bookmark ID and source ID.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2 and require exit code 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/storage/shared.ts backend/src/storage/bookmarks.ts backend/src/ingest/source-sync.ts backend/test/storage/bookmarks.spec.ts backend/test/ingest/source-sync.spec.ts
git commit -m "fix: preserve feed publication dates"
```

### Task 5: Expose schedules and correct dashboard dates

**Files:**
- Modify: `backend/src/storage/sources.ts`
- Modify: `backend/src/storage/stats.ts`
- Modify: `backend/test/storage/sources.spec.ts`
- Modify: `backend/test/storage/stats.spec.ts`
- Modify: `backend/dashboard/src/lib/state.ts`
- Modify: `backend/dashboard/src/main.ts`
- Modify: `backend/dashboard/test/main.spec.ts`

**Interfaces:**
- Source/API output: `nextPollAt?: string`, `pollIntervalMinutes: number`.
- Bookmark dashboard input: optional `metadata.publishedAt`.

- [ ] **Step 1: Write failing API and dashboard tests**

Extend source and stats fixtures with scheduling columns and assert camel-case API output. Add dashboard fixtures where `publishedAt` differs from `createdAt`; assert the card contains the locale date derived from `publishedAt` and not the import date. Open the item and assert the reader date begins with `Published `. Add a bookmark without `publishedAt` and assert its reader date begins with `Saved `.

- [ ] **Step 2: Run focused tests and verify RED**

Run Worker tests:

`cd backend && npx vitest run test/storage/sources.spec.ts test/storage/stats.spec.ts --config vitest.config.mts`

Run dashboard test:

`cd backend && npx vitest run dashboard/test/main.spec.ts --config vitest.dashboard.config.mts`

Expected: FAIL because scheduling metadata and publisher-date rendering are absent.

- [ ] **Step 3: Implement API mapping and date rendering**

Select/map schedule fields in source and health queries. Extend dashboard types. Add one local helper that chooses `publishedAt ?? createdAt` safely. Cards use the chosen value. Reader headers render exactly `Published <local date/time>` when publisher metadata exists, otherwise `Saved <local date/time>`, and no longer append bookmark `updatedAt` as an editorial update.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run both commands from Step 2 and require exit code 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/storage/sources.ts backend/src/storage/stats.ts backend/test/storage/sources.spec.ts backend/test/storage/stats.spec.ts backend/dashboard/src/lib/state.ts backend/dashboard/src/main.ts backend/dashboard/test/main.spec.ts
git commit -m "fix: show feed publication dates"
```

### Task 6: Configure, document, and verify the complete feature

**Files:**
- Modify: `backend/wrangler.jsonc`
- Modify: `backend/worker-configuration.d.ts`
- Modify: `README.md`
- Modify: `TECHNICAL_ARCHITECTURE.md`
- Modify: affected tests if full-suite integration exposes a genuine regression.

**Interfaces:**
- Cron expression: `*/10 * * * *`.
- No production deployment or remote migration.

- [ ] **Step 1: Change the Cron heartbeat and documentation**

Set the checked-in Cron expression to `*/10 * * * *`. Update README and technical architecture to explain that the heartbeat dispatches due feeds, intervals are 10-360 minutes with a 60-minute default, and article publication dates are preserved.

- [ ] **Step 2: Regenerate and check Worker types**

Run: `cd backend && npm run cf-typegen`

Then run: `cd backend && npx wrangler types --check`

Expected: both commands exit 0 and `worker-configuration.d.ts` reflects the checked-in bindings/configuration.

- [ ] **Step 3: Run complete Worker and dashboard tests**

Run: `cd backend && npm test`

Expected: all Worker and dashboard tests pass with zero failures. If the known registration fixture mismatch reappears, report it separately and still require every adaptive-scheduling/publication-date focused test to pass.

- [ ] **Step 4: Build dashboard assets**

Run: `cd backend && npm run build`

Expected: exit code 0 with generated assets updated only as produced by the established build script.

- [ ] **Step 5: Perform deployment dry-run**

Run: `cd backend && WRANGLER_LOG_PATH=/tmp/keeproot-adaptive-wrangler.log npx wrangler deploy --dry-run`

Expected: exit code 0. Do not deploy.

- [ ] **Step 6: Self-review the final diff**

Run:

```bash
git status --short
git diff --check
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- backend/src backend/test backend/dashboard backend/migrations backend/wrangler.jsonc README.md TECHNICAL_ARCHITECTURE.md
```

Confirm no unrelated changes, no secret values, no destructive migration, and every specification requirement has a corresponding implementation and test.

- [ ] **Step 7: Commit final configuration/documentation**

```bash
git add backend/wrangler.jsonc backend/worker-configuration.d.ts backend/public README.md TECHNICAL_ARCHITECTURE.md
git commit -m "docs: document adaptive feed crawling"
```
