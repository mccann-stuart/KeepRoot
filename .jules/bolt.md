## 2025-05-18 - Cloudflare Workers KV Caching
**Learning:** Cloudflare Workers frequently access KV stores for simple repetitive configuration values (like API Secrets or global settings) on every request, which incurs unnecessary latency (~10-50ms per KV read) and uses up KV read operations.
**Action:** Use a global module-level variable to cache frequently accessed, rarely changing KV values in memory. Since a Cloudflare Worker isolate handles multiple requests over its lifetime, this pattern caches the result for the lifetime of the isolate, significantly reducing latency and KV reads on subsequent requests.

## 2025-05-18 - Cloudflare D1 Batch Inserts & Fire-And-Forget Promises
**Learning:** In Cloudflare Workers, unawaited "fire-and-forget" promises (e.g., updating a `last_used_at` DB row without `await`) will be aggressively aborted as soon as the HTTP response is sent unless passed to `ctx.waitUntil()`. Furthermore, loops executing D1 prepared statements sequentially result in severe N+1 HTTP roundtrips.
**Action:** Always use `D1Database.batch()` to combine multiple `DELETE`/`INSERT` queries into a single roundtrip. When batching `INSERT`s from array inputs, ensure the array is deduplicated beforehand to avoid unique constraint violations within the same transaction batch. Never use unawaited promises for side effects without `ctx.waitUntil()`.

## 2025-05-18 - Concurrent R2 Uploads
**Learning:** Performing multiple sequential R2 uploads (like saving multiple images for a bookmark) significantly increases I/O latency in Cloudflare Workers because each upload represents a network roundtrip that pauses execution.
**Action:** Always process multiple independent R2 operations concurrently using `Promise.all()` to ensure they happen in parallel, vastly reducing the total request latency. Similarly, batch any resulting D1 updates into a single roundtrip via `D1Database.batch()`.

## 2025-05-18 - String Creation Overhead in Byte Conversion
**Learning:** When dealing with large payloads like content hashes or fetched images in Cloudflare Workers, mapping or looping over bytes (`Uint8Array`) one-by-one to create strings via `String.fromCharCode(byte)` or `.toString(16)` incurs severe memory overhead and execution latency from millions of tiny string allocations.
**Action:** For base64 conversion, process bytes in chunks using `String.fromCharCode.apply(null, chunk)` (e.g., chunk sizes of 8192) to vastly improve latency and reduce heap allocations. For fast byte-to-hex conversion, precompute a static array map of 256 hexadecimal string pairs (`Array.from({length: 256}, ...)`), and concatenate values from the map in a tight `for` loop to avoid dynamic function allocations.

## 2026-03-19 - Batched D1 Queries for Resolving N+1 Problems
**Learning:** Running sequential D1 queries inside a loop when hydrating multiple results (like fetching metadata and tags for multiple search candidates) creates severe N+1 HTTP roundtrips, massively inflating latency as the number of candidates grows.
**Action:** Use `IN (?, ?, ...)` SQL queries to batch-fetch records for multiple IDs simultaneously. To avoid exceeding D1 limits (like maximum bound parameters), slice the IDs into smaller batches (e.g., 50 at a time) and process those batches sequentially instead of individual IDs.
