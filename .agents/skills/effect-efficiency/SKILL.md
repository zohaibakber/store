---
name: effect-efficiency
description: Optimize Effect runtime reuse, concurrency, PowerSync traffic, or startup latency in this monorepo.
---

# Effect efficiency

Identify the work or wait responsible for the cost before choosing an optimization. Use the installed Effect API and preserve the runtime's authority and lifecycle boundaries.

- Reuse a host-owned `ManagedRuntime`; dispose it with its host. Share layers only where their dependencies and lifetimes allow it.
- Bound concurrent work with a semaphore; use layer-owned caches for repeated lookups when their invalidation model fits.
- Use `SubscriptionRef` for observable latest state and scoped consumers for owned streams. Detached fibers need an explicit lifetime beyond the caller.
- Keep network sync off the first-paint path. Render the shell and preload local data while synchronization proceeds; gate only views that require synced rows.
- Inventory authority is Postgres. Preserve PowerSync queued catalog writes, upload ordering, and organization isolation.
- Reuse the shared HttpApi contract in Effect domains; thin browser session adapters may use `fetch`.

## References by task

- Runtime, semaphore, cache, and stream selection: [WHEN.md](references/WHEN.md).
- Connect/upload lifecycle, logout cleanup, and cold start: [SYNC-NETWORK.md](references/SYNC-NETWORK.md).
- Evaluating a pattern from OpenCode, t3code, or Maple: [OSS.md](references/OSS.md).
- API recipes: [Effect](../effect/SKILL.md).

Verify the affected latency, request count, concurrency bound, or lifecycle behavior. Choose the check that demonstrates the intended improvement.
