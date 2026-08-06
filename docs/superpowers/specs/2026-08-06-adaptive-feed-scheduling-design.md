# Adaptive Feed Scheduling and Publication Dates

## Objective

KeepRoot should poll active feeds at a cadence learned from each feed's publication history. Frequently updated feeds should remain fresh, while infrequent feeds should avoid unnecessary requests. Feed articles in the dashboard should show the publisher's timestamp rather than the time KeepRoot imported them.

The change must retain the existing queue-first crawler, HTTP validators, source leases, entry fingerprints, continuation jobs, retry policy, safe-URL validation, and inbox deduplication.

## Users and value

The primary user is a self-hosted KeepRoot owner who expects fast delivery from active publications without repeatedly polling quiet feeds. The adaptive cadence improves visible freshness where it matters and reduces unnecessary requests to feed publishers. Showing publication dates makes article chronology understandable and avoids presenting bulk-import time as editorial metadata.

## Scheduling architecture

Cloudflare Cron remains the recovery-safe scheduler and `SOURCE_QUEUE` remains the execution boundary.

- Change the Cron Trigger from every two hours to every ten minutes.
- Add `next_poll_at` and `poll_interval_minutes` to `sources`.
- Default new and migrated sources to a 60-minute interval.
- Add a partial index supporting active, pollable sources ordered or filtered by `next_poll_at`.
- Scheduled dispatch selects only active sources whose `next_poll_at` is absent or no later than the scheduled event time.
- Existing dispatch keys remain `cron:<scheduled-time>:<source-id>`, preserving idempotency when Cloudflare repeats a scheduled event.
- Manual and newly-created-source synchronisation bypass the due-time filter and continue to enqueue immediately.

This design uses a frequent, inexpensive D1 due-time check instead of self-perpetuating delayed Queue messages. The Cron heartbeat can recover naturally after deployments, queue disruption, source reactivation, or scheduling-state repair.

## Smart interval calculation

The feed parser already captures RSS `pubDate`/`isoDate` and Atom `updated`/`published`. A pure calculation function will receive those timestamps and return a whole number of minutes.

1. Parse valid timestamps and sort them from newest to oldest.
2. Use at most the 50 newest timestamps so an old publication regime does not dominate the current cadence.
3. Calculate positive gaps between adjacent timestamps.
4. If there are fewer than two timestamps, no positive gaps, or no positive time span, use the 60-minute default.
5. Calculate average gap from the positive gaps and posts per hour as positive gap count divided by the total positive time span in hours.
6. If the rate exceeds one post per hour, use the 10-minute minimum.
7. If the rate is below 0.01 posts per hour, use the 360-minute maximum.
8. Otherwise poll at one third of the average publication gap, rounded to the nearest minute.
9. Clamp every result to 10 through 360 minutes.

The algorithm intentionally follows the referenced AdaptiveFetcher policy while adding guards for invalid, duplicated, and unsorted feed dates.

## Scheduling state transitions

`syncSource` will return a recommended interval after a successful `200` response. Queue result handling owns persisted scheduling state.

- Successful changed feed: persist the newly calculated interval and set `next_poll_at` from the completion time.
- Successful feed with insufficient timing evidence: persist the 60-minute default.
- `304 Not Modified`: retain the previously learned interval and advance `next_poll_at` by that interval.
- Continuation required: retain the same run and set a provisional next poll so another Cron heartbeat cannot start redundant work while the continuation catches up.
- Retryable failure: preserve Queue retry behaviour and move `next_poll_at` forward by at least the current interval.
- Terminal or non-retryable failure: move `next_poll_at` forward by the greater of the current interval and 60 minutes. Existing health metrics and dead-letter visibility continue to surface the failure.
- Removed or paused source: scheduled dispatch excludes it.
- Reactivated source: existing immediate sync behaviour re-learns the interval without losing source identity.

Intervals are operational hints, not exact timers. Queue delivery and Cron execution may occur later than `next_poll_at`, but never intentionally earlier through scheduled dispatch.

## Publication timestamp storage and UI

Add nullable `published_at` to `bookmarks` and optional `publishedAt` to bookmark payloads and metadata.

- New or changed feed entries normalise a valid publisher timestamp to ISO 8601 and persist it.
- Invalid or absent publisher timestamps remain `NULL`.
- During a feed sync, existing matched entries with a missing `published_at` are backfilled directly from feed metadata even when their content fingerprint is unchanged. This avoids expensive content rewrites and repairs existing imported articles as feeds are revisited.
- Non-feed saves remain unchanged and fall back to `createdAt`.
- Bookmark cards render `publishedAt` when present, otherwise `createdAt`.
- The reader header labels the value as `Published` when `publishedAt` exists and `Saved` otherwise.
- The reader header stops presenting bookmark `updatedAt` as an article-update timestamp because bookmark actions and content refreshes can change it independently of publisher edits.

This change affects displayed dates only. Bookmark ordering remains unchanged to avoid widening the behavioural scope.

## API and observability

Source records and source-health output should expose `pollIntervalMinutes` and `nextPollAt`. This makes the learned behaviour inspectable without adding a separate dashboard control surface. The crawler continues to emit the existing privacy-safe run summaries.

No new dependency or Cloudflare service is required.

## Error handling and safety

- Safe-URL validation and redirect validation remain on every feed request.
- Date parsing never throws for publisher-controlled values; invalid values are ignored.
- Interval calculation uses finite positive values only and always returns a bounded integer.
- D1 writes stay source-scoped or bookmark/user-scoped as appropriate.
- Migration is additive and does not overwrite existing timestamps or delete data.
- Queue retries remain responsible for transient `408`, `429`, network, and `5xx` failures.

## Test strategy

Implementation follows test-driven development.

Worker tests will cover:

- frequent, ordinary, and infrequent feed histories;
- unsorted, duplicate, invalid, and insufficient timestamps;
- the 10-minute minimum, 60-minute default, and 360-minute maximum;
- scheduled dispatch selecting only due sources and retaining Cron idempotency;
- manual sync bypassing due-time filtering;
- successful, `304`, continuation, retryable-failure, and terminal-failure scheduling transitions;
- publication-date persistence for new/changed entries;
- lightweight publication-date backfill for unchanged existing entries;
- schema compatibility and migration columns/indexes;
- source and health API scheduling metadata.

Dashboard tests will cover:

- cards preferring `publishedAt` over `createdAt`;
- reader headers labelling feed dates as `Published`;
- fallback to `Saved` for bookmarks without publisher dates.

Final verification will run the focused tests during red/green cycles, the complete Worker and dashboard suites, dashboard build, generated Worker type check, and Wrangler deployment dry-run. No deployment is authorised by this specification.

## Out of scope

- Publisher-provided RSS TTL hints.
- Day-of-week, time-of-day, or burst-pattern prediction.
- Subscriber-count prioritisation; KeepRoot is currently self-hosted rather than a shared multi-tenant feed service.
- Changes to bookmark ordering.
- New Cloudflare Workflows, Durable Objects, Analytics Engine, or external monitoring.
- Production migration or deployment.
