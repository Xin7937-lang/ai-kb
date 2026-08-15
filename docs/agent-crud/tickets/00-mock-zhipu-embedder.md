# 00 — Test infrastructure: mock Zhipu embedder

**What to build:** A reusable mock embedding helper module that unit tests can swap in for the real Zhipu embedder. Allows exercising the embedding-disabled fallback path without hitting the real API, so the create_note tool can be verified end-to-end without a network dependency.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Helper module exists in the AI module area, exported alongside the real embedder for opt-in use by tests
- [ ] Helper exports a function matching the real embedder's public signature, returning deterministic 2048-dim float arrays (fixed seed so tests are reproducible)
- [ ] Helper supports a "force failure" mode (env-flag or function flag) that throws or returns a typed error, simulating the real path's graceful-degradation behavior
- [ ] Existing smoke-embed script is unchanged — it still uses the real Zhipu embedder (mock is opt-in for tests only)
- [ ] Helper is documented enough that future tool tests can import and use it without re-reading the source
- [ ] No production request path imports the mock (lint-checkable via grep on request-path modules)