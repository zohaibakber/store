---
name: effect
description: Implement or debug Effect v4 services, schemas, layers, and effectful workflows.
license: MIT
compatibility: Requires Effect v4. Examples are reviewed against the version documented in this repository.
---

# Effect v4

Check the installed Effect version and source for API questions. This project uses v4 RCs; examples may lag its pin. Follow established project conventions and consult upstream v4 documentation when local types do not resolve a question.

## Project defaults

- Compose with `Effect.gen`; use named `Effect.fn` for service operations where tracing matters.
- Services use `Context.Service` and explicit layers. A service's `make` does not generate its layer.
- Model boundary data with `Schema.Struct` and typed errors with `Schema.TaggedError`. Schema is exported from `effect`; avoid v3 `Context.Tag`, `@effect/schema`, and `Schema.TaggedErrorClass` assumptions.
- Decode untrusted values at boundaries. Keep business rules in services and provider calls outside authoritative database transactions.
- Provide required credentials and services explicitly. `Context.Reference` defaults must not silently replace required authority.
- Retry only operations whose idempotency is established; keep exhausted failures visible unless a real fallback exists.

## References by task

- Data models and decoding: [schemas](references/SCHEMA.md).
- Services, errors, layers, and runtime ownership: [services and layers](references/SERVICES_LAYERS.md).
- Runtime environment configuration: [config](references/CONFIG.md).
- Retry, polling, and backoff: [scheduling](references/SCHEDULING.md).
- TTL, deduplication, and batching: [caching](references/CACHING.md).
- Event sources and backpressure: [streams](references/STREAMS.md).
- Outgoing requests: [HTTP clients](references/HTTP_CLIENTS.md).
- Effect test clocks and synchronization: [testing](references/TESTING.md).

Load the sections relevant to the change. Performance work involving runtime reuse or first paint is covered by [effect-efficiency](../effect-efficiency/SKILL.md).
