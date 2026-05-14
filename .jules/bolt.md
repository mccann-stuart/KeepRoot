## 2026-05-14 - Document Rewriting O(N*M) Bottleneck
**Learning:** In Cloudflare Workers, processing arrays of image strings by repeatedly scanning and replacing across an entire Markdown/HTML document causes an O(N*M) processing overhead, creating memory pressure and blocking the main thread.
**Action:** When handling bulk string replacements (e.g., rewriting image URLs in large strings), parallelize the processing of individual objects via `Promise.all`, consolidate the replacement values into a single `Map`, and execute the document scan/replace strictly once using the consolidated Map.
