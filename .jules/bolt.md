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

## 2026-03-19 - Object.entries Array Allocation Overhead
**Learning:** Using `Object.entries()` followed by array methods like `.filter()` and `Object.fromEntries()` inside frequently called utilities (like `compactObject`) creates multiple intermediate array allocations per call. In Cloudflare Workers with high-traffic payloads (like hydrating search results or lists), this creates excessive Garbage Collection (GC) pressure and slows down response times.
**Action:** When filtering or mapping object properties for performance-critical functions, use a procedural `for...in` loop instead of `Object.entries()`. Always include an `Object.prototype.hasOwnProperty.call(value, key)` check to ensure only the object's own enumerable properties are processed, mirroring the exact semantics of `Object.entries()`.

## 2026-03-25 - Intermediate Array Allocations from Array Methods
**Learning:** Using chained array methods like `.map().filter()` inside loops or heavily-called filter functions (like evaluating search candidates against options) creates multiple intermediate array allocations and executes numerous callback functions. In Cloudflare Workers, this execution context overhead and heap churn leads to increased garbage collection pressure and latency, especially as the number of items grows.
**Action:** Replace chained array methods on critical paths with procedural `for` loops. Accumulate the final result directly into a single target array. When narrowing types from optional properties (e.g., `obj?.tags`), assign the property to a local variable first before checking `Array.isArray()` to satisfy the TypeScript compiler.

## 2026-03-26 - Batched D1 Queries for Concurrent Reads
**Learning:** Firing multiple concurrent D1 queries with `Promise.all()` (e.g., 7 `SELECT` statements for building a user's stats dashboard) still results in 7 separate HTTP network roundtrips to Cloudflare's D1 API, accumulating network-level latency and creating overhead.
**Action:** Always use `D1Database.batch()` for reads (like `SELECT`s), not just for mutations. Grouping multiple independent reads into a single `.batch()` call reduces the network roundtrips from N down to exactly 1, drastically reducing the total latency required to fetch multiple datasets.

## 2026-03-27 - Iterator Array Allocations from Spread Operations
**Learning:** Spreading iterators into arrays (e.g., `[...searchParams.entries()]`) immediately followed by an array `.filter()` creates multiple intermediate array allocations and executes a callback function for each iteration. When normalizing URLs with numerous tracking parameters, this memory pressure adds latency in Cloudflare Workers.
**Action:** Iterate directly over the iterator with a procedural `for...of` loop (e.g., `for (const [key, value] of searchParams.entries())`). This avoids the spread allocation, the `.filter()` function execution overhead, and intermediate array creation, resulting in a single direct iteration.
