# Browser Run crawl lifecycle incident — 13 August 2026

## What happened

The first Agentic scraping attempt failed authentication. After the operator corrected the credential binding, Browser Run accepted a replacement crawl and continued processing it, but KeepRoot still displayed the earlier `401` error. The local 30-minute deadline then cancelled the valid upstream job before results were available. Repeated manual Refresh actions had also created duplicate D1 runs; those queue deliveries could not acquire the source lease and eventually stopped retrying without reaching a terminal D1 status.

The result was a misleading combination: Browser Run had authenticated and started work, the dashboard retained an obsolete authentication error, one run timed out, three duplicates appeared stuck, and no pages reached recognition or import.

## Learnings

1. Acceptance of an asynchronous job is a meaningful phase boundary. It proves the current credential reached Browser Run successfully, so a stale source-level authentication error must not remain authoritative.
2. Queue retry state and the durable run state must agree. A message that will be acknowledged or exhaust retries needs a terminal D1 outcome; otherwise the dashboard invents work that no longer exists.
3. Operator actions need idempotency at the source boundary. A button can be pressed from multiple tabs or during uncertainty, and each press must not spend scarce upstream crawl quota.
4. A timeout must match the asynchronous service and workload. A 100-page rendered crawl can legitimately exceed 30 minutes; the timeout is an operational guardrail, not a latency target.
5. End-to-end health requires phase evidence. Authentication, upstream crawling, result paging, recognition and import are distinct boundaries and should be observable independently.

## Four production fixes

1. **Coalesce duplicate Refresh requests.** `enqueueSourceRun` atomically reserves the source lease before publishing. A concurrent request returns `{ queued: false, runId: <active> }`, and the dashboard reports “Refresh already running”.
2. **Terminalise lease-race duplicates.** Queue deliveries that lose the source lease are acknowledged and marked `cancelled`. When a new run acquires the lease, it also cancels unfinished orphan runs for the same source.
3. **Clear superseded errors at acceptance.** After `/crawl` returns an upstream job ID, the source's previous error is cleared while the new run remains `waiting`. Later failures still replace it with the current actionable error.
4. **Use a realistic deadline and phase logs.** The KeepRoot crawl deadline is now two hours. Structured logs cover queueing, coalescing, upstream acceptance, status polls, result pages, completion and cancellation using stable IDs and counters without URLs or secrets.

## Operational interpretation

- `waiting` with an upstream job ID means Browser Run accepted the request and KeepRoot is polling it; it does not yet prove that any posts were recognised.
- `cancelled` means the run was superseded locally and will not consume further queue retries.
- A first completed crawl with zero recognised posts remains an error because the site lacks the supported article signals.
- A later completed crawl with zero new URLs is a valid success.
- The 100-page cap still marks saturation. Increasing the timeout does not increase page or daily job quotas.

## Verification expectations

Regression coverage must prove refresh coalescing, orphan cancellation, lease-collision terminalisation, stale-error clearing, the two-hour timeout and safe logs. Release checks include Worker tests, dashboard tests, TypeScript/build validation, local migration application and a Wrangler deployment dry run.
