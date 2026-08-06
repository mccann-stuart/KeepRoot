# Source Health Manual Refresh Design

## Goal

Let a signed-in KeepRoot owner force a check of one refreshable feed from Source Health without changing the feed's adaptive schedule or waiting for the queued crawl to finish.

## User experience

- Each active, pollable Source Health row shows a compact **Refresh** button.
- Selecting it disables only that button and changes its label to **Queueing…** while the request is in flight.
- A successful request restores the button and shows **Refresh queued**.
- The dashboard does not poll for run completion. Normal data refreshes will later show the resulting run and updated schedule.
- A failed request restores the button and shows the API error.
- Non-pollable sources, such as email ingestion sources, do not show the action.

## API and data flow

The dashboard sends `POST /sources/:id/refresh` through the existing authenticated API client. The Worker:

1. Loads the source by both authenticated `user_id` and requested source ID.
2. Returns `404` when the source is not owned by the caller or does not exist.
3. Returns `400` when the source is inactive or has no poll URL.
4. Enqueues an existing `manual` source run and returns `202` with `{ queued: true, runId }`.

The manual run bypasses `next_poll_at`, while the existing queue processor recalculates and persists the adaptive interval after the fetch. The endpoint is classified as a source-sync write action so the existing rate-limit and observability path applies.

## Scope and safeguards

- Reuse `enqueueSourceRun`; do not add a second crawler path.
- Do not alter scheduled dispatch, leases, retries, HTTP validators, or adaptive interval calculation.
- Do not expose whether another user's source ID exists.
- Do not add completion polling, bulk refresh, cancellation, or a new database migration.
- The button is rendered from the Source Health entry cross-referenced with the already-loaded source list, so only active sources with a poll URL are actionable.

## Testing

- Route tests cover owned pollable sources, missing sources, inactive/non-pollable sources, and enqueue failures.
- API-client tests or dashboard interaction tests verify the request path and method.
- Dashboard tests verify button visibility, busy state, success toast, and error recovery.
- The full Worker and dashboard test suites, build, type checks, and Wrangler dry-run must remain green.
