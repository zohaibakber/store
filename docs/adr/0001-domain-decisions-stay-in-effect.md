# Domain decisions stay in Effect

The shop's rules are pure functions that return a `Result`. They are not hosted on `@alchemy.run/domain`.

## Status

Accepted

## Context

[Alchemy's domain guide](https://alchemy.run/domain/what-is-ddd/) names the pieces this shop already has: a command asks for a change, an aggregate accepts it or refuses it, an event records what happened, and a view answers a question from those facts. `@alchemy.run/domain` implements that as a model hosted on a Durable Object, with the events as the stored record.

This shop already has that split, with a different record. A device keeps a replica, commits a command locally, and syncs it to one organization authority. The authority can refuse, and the refusal comes back as a receipt. Replicas then share the accepted rows. `effect/eventlog` was already rejected for this reason: an event log that only replicates accepted entries cannot refuse a command.

Effect already has the better expression of the same ideas for this record. A business rule is a pure function over parsed values and returns `Result`, with no services and no clock. A refusal is a `Schema.TaggedError`. The replica and the authority both call that function. Views stay the named reads. Policies that need the network, a PIN or a signature stay in the service that owns that effect.

## Decision

- Commands, refusals and the rules that accept them live in `@store/contracts` as plain values. Staff setup, roster changes and draft handover are decided there. Catalogue invariants (`checkCanDeleteCategory` and its neighbours) are the same kind of function, and both the replica projection and the local authority call them.
- The replica projection's catalogue decision returns `Result`. It does not throw a protocol error to stop a command. The protocol error is built once, at the edge that reports the refusal.
- Evolve stays beside that decision: applying an accepted catalogue write still produces the rows the sync log stores. Those rows are the record. There is no second event store.
- `@alchemy.run/domain` is not a dependency. Adopting it would replace the replica, the receipt and the authority with its own log.

## Consequences

- A new shop rule is a pure `Result` in the contract, with the words in `GLOSSARY.md`, and both sides of a command call it.
- A screen's read model is added as a named read. It does not grow a rule.
- Reopening a hosted domain model needs a new fact about refusals and receipts, the same bar as reopening `effect/eventlog`.
