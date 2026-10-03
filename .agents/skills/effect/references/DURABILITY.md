# Durable work and recovery

Read this when work must survive a restart or when changing a persisted command queue, receipt, replay or checkpoint. A scope owns live resources. Persistence records what the next process must recover. Ordinary scoped work needs no journal.

These lessons come from [Tardigrade core at `6f47172`](https://github.com/clavia-labs/tardigrade/tree/6f47172d3f3adbef2740a864e76c02a51ac214dd/packages/core), which uses `effect@4.0.0-rc.115`. Apply them through Store's existing services and sync contracts. Keep Store's namespace imports, `Context.Service` layers, `Schema.TaggedError`, boundary decoders and runtime edges, and verify API spellings against the installed `effect@4.0.0`. Adding Tardigrade or another workflow engine is a separate architecture decision.

## Commit before publishing or executing

For an operation whose acceptance must survive a crash, use this order:

```text
parse input -> prepare transition -> commit acceptance and intent
             -> publish committed state -> execute accepted work
             -> commit outcome -> notify consumers
```

- Derive candidate state and follow-up records without mutating the committed view or doing external I/O. A projection may run again during validation or replay.
- Commit the state change and its required outbox or receipt records atomically. An in-process `Semaphore` orders local callers; a transaction, unique constraint or expected-version check must enforce the storage invariant across writers.
- Publish an accepted status, binding or completion only after its supporting commit succeeds. Store may show a separate optimistic state, but that state cannot claim server acceptance.
- A rejected commit discards the candidate. If the storage result is uncertain, reconcile or rebuild from persisted state before accepting more work against the in-memory view. A later notification failure leaves the successful commit intact; recover required delivery through the outbox.

Tardigrade's [commit path](https://github.com/clavia-labs/tardigrade/blob/6f47172d3f3adbef2740a864e76c02a51ac214dd/packages/core/src/runtime/execution.ts) prepares records, persists them, then publishes state and schedules work. Its [acceptance property](https://github.com/clavia-labs/tardigrade/blob/6f47172d3f3adbef2740a864e76c02a51ac214dd/packages/platform/test/properties/runtime/reference-acceptance-atomicity.ts) pauses the commit and checks that neither the accepted reference nor execution appears early.

## Recover by operation identity

An accepted operation has a stable identity and immutable input. A retry or restart reuses both. A new invocation gets a new identity. Reusing an identity with different input is a conflict. Attempt ids belong to diagnostics and progress events; they cannot replace the idempotency key.

Choose recovery from the persisted evidence:

| Persisted evidence | Recovery action |
| --- | --- |
| Accepted intent, outcome unknown | Reconcile or repeat with the same idempotency key and the guarantee from [retry](RETRY.md). |
| Remote job handle accepted | Resume observing that handle. Submit again only if the provider's contract makes that safe. |
| Unfinished work owned by a lost local process | Reconstruct the producer under a new scope with the original operation identity and safe replay semantics. |
| Terminal result or receipt | Return or redeliver the stored result without repeating the mutation. |
| Cancellation recorded, cleanup unfinished | Resume idempotent cleanup from the stored request and any accepted handle. |

Persist an absolute deadline when the operation's waiting budget must survive restarts. Recovery computes the remaining time with `Clock.currentTimeMillis`; it does not grant another full timeout. A timeout for one network attempt remains separate from that operation deadline.

Tardigrade distinguishes [restarting a local producer from observing a remote handle](https://github.com/clavia-labs/tardigrade/blob/6f47172d3f3adbef2740a864e76c02a51ac214dd/packages/platform/test/properties/runtime/deferred-recovery.ts) and preserves expiry in [promiseDeadline](https://github.com/clavia-labs/tardigrade/blob/6f47172d3f3adbef2740a864e76c02a51ac214dd/packages/core/src/services/promises.ts).

## Cancellation has durable meaning

Separate a caller ceasing to wait, the domain accepting cancellation, and an executor finishing cleanup. A disconnected caller or a closed scope establishes only the local lifetime change.

When cancellation must survive a restart, persist the decision and enough information to retry cleanup. Serialize completion and cancellation at the owner that commits terminal state. Define which transition wins, reject conflicting duplicates, and prevent late results from reviving cancelled work. A handle arriving after cancellation may still need recording for cleanup without changing the visible terminal result.

Use interruption and scopes for local resources. Use the provider's cancellation operation when remote work supports cancellation. Cleanup may run more than once, so it needs an idempotency guarantee and a visible failure policy.

Protect the handoff of an accepted handle to its owner against interruption. Prefer scoped acquisition when it expresses the ownership; use a narrow `Effect.uninterruptibleMask` when a multi-step handoff needs it. Restore interruptibility for waits that are safe to abandon. Any masked I/O needs an adapter-level bound; wrapping an uninterruptible request in `Effect.timeout` alone cannot guarantee prompt shutdown. Process loss can still occur at every step, so recover the remote handle by the persisted operation identity.

Tardigrade models [local cancellation separately from executor cleanup](https://github.com/clavia-labs/tardigrade/blob/6f47172d3f3adbef2740a864e76c02a51ac214dd/packages/core/src/runtime/effects.ts) and exercises [late submission, repeated cleanup and terminal delivery](https://github.com/clavia-labs/tardigrade/blob/6f47172d3f3adbef2740a864e76c02a51ac214dd/packages/platform/test/properties/runtime/cancellation.ts).

## Replay and checkpoints

Replay computes state and outstanding work from recorded facts. It performs no network calls, starts no fibers and generates no new identity or time. Record nondeterministic values at acceptance and pass them into the reducer. Execution resumes after reconstruction has completed.

A checkpoint must preserve the state and recovery decisions produced by replaying its prefix. Persist its position with the corresponding state, then replay only the suffix. If pending operations are omitted by the checkpoint format, checkpoint only when none remain. A format that permits pending operations must preserve their identities, inputs, handles, deadlines and cleanup obligations.

Encode state with its owning Schema and decode it on restore. A schema's decoded value may differ from its stored representation. `Schema.toType` checks the decoded side and removes the codec transformation, so it cannot replace decoding stored bytes. Validate the checkpoint version and positions as boundary data.

Include state that was never read before capture. A snapshot of only initialized caches or observed atoms can lose a lazy projection's history after prefix compaction. Either capture everything needed to rebuild it or retain the history needed for its first read. Check full replay against checkpoint plus suffix for the visible state and outstanding work.

Tardigrade's [replay module](https://github.com/clavia-labs/tardigrade/blob/6f47172d3f3adbef2740a864e76c02a51ac214dd/packages/core/src/runtime/replay.ts) separates reconstruction from execution and restricts checkpoint capture. It also records an unresolved lazy-atom checkpoint issue. Its [model](https://github.com/clavia-labs/tardigrade/blob/6f47172d3f3adbef2740a864e76c02a51ac214dd/packages/core/quint/checkpoint/lazyAtomCheckpoint.qnt) makes that omitted-state case explicit; the implementation is not a blanket correctness guarantee.

## Progress and results

Progress delivery can be lossy when consumers can resynchronize. Accepted work and terminal outcomes need an authoritative stored read. Select buffering and subscription ownership using [streams](STREAMS.md); Tardigrade makes this separation explicit in its [execution stream](https://github.com/clavia-labs/tardigrade/blob/6f47172d3f3adbef2740a864e76c02a51ac214dd/packages/core/src/services/execution-stream.ts) and [stream tests](https://github.com/clavia-labs/tardigrade/blob/6f47172d3f3adbef2740a864e76c02a51ac214dd/packages/platform/test/bun/execution-stream.test.ts).

Exercise the commit and recovery boundaries using [testing](TESTING.md). A clean reopen tests reconstruction; abrupt process termination is needed to establish behavior when finalizers never run.
