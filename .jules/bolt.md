## 2025-05-18 - Cloudflare Workers KV Caching
**Learning:** Cloudflare Workers frequently access KV stores for simple repetitive configuration values (like API Secrets or global settings) on every request, which incurs unnecessary latency (~10-50ms per KV read) and uses up KV read operations.
**Action:** Use a global module-level variable to cache frequently accessed, rarely changing KV values in memory. Since a Cloudflare Worker isolate handles multiple requests over its lifetime, this pattern caches the result for the lifetime of the isolate, significantly reducing latency and KV reads on subsequent requests.

## 2025-05-18 - Cloudflare D1 Batch Inserts & Fire-And-Forget Promises
**Learning:** In Cloudflare Workers, unawaited "fire-and-forget" promises (e.g., updating a `last_used_at` DB row without `await`) will be aggressively aborted as soon as the HTTP response is sent unless passed to `ctx.waitUntil()`. Furthermore, loops executing D1 prepared statements sequentially result in severe N+1 HTTP roundtrips.
**Action:** Always use `D1Database.batch()` to combine multiple `DELETE`/`INSERT` queries into a single roundtrip. When batching `INSERT`s from array inputs, ensure the array is deduplicated beforehand to avoid unique constraint violations within the same transaction batch. Never use unawaited promises for side effects without `ctx.waitUntil()`.
