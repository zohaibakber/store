# Design: what owns what

Decide the owner before writing the service. Classify each piece of a change by what would make it change.

| It changes when | It is | In Effect terms |
| --- | --- | --- |
| A business meaning, invariant, calculation or legal transition changes | **Domain module** | Pure functions over parsed values. Returns values, `Option` or `Result`. No `Effect`, no services, timestamps and ids passed in. |
| Policy, authorization or the order of effects changes | **Application service** | A `Context.Service` whose methods take and return domain types and list their failures. |
| A protocol, framework, database or vendor API changes | **Adapter** | Inbound: decode, call one service method, render the result. Outbound: a layer that implements a capability with one technology. |
| What is wired to what changes | **Composition root** | Layer constants and one edge. No logic. |

```txt
external input -> inbound adapter -> application service -> domain module
                                            |
                                            +-> capability service -> outbound adapter -> external system
```

Domain modules are the functional core; services and adapters are the shell. An inbound adapter may call a domain module directly when the operation is pure.

For each operation you change, trace it from ingress to every effect and observable result, and give each decision and effect exactly one owner. `packages/contracts/src/catalog/rules.ts` is domain, `apps/auth/src/login.ts` is an application service, `packages/sync/src/transport.ts` is an outbound adapter, `apps/auth/infra.ts` is a composition root.

## Service or value

A service owns at least one of:

- authority over persistence, credentials, external I/O, a runtime resource, configuration, time, randomness or a lifecycle;
- effect sequencing or policy reused across entry points;
- state, or behaviour that really varies between production, tests and hosts.

Effect already ships the common ones: `Clock`, `Random`, `Crypto.Crypto`, `Config`, `HttpClient`, `FileSystem`, `Path`, `KeyValueStore`, `SqlClient`. Use those before defining your own.

Everything else is a value or a pure module: parsed inputs and per-call request data, deterministic calculations and constructors, options that select a policy for one call, framework values that stay inside their adapter. A wrapper that only renames or forwards another service is neither; delete it. Wanting to inject something in a test is a reason for a fixture, and a service only when production also varies.

## Before adding an abstraction

1. Look for an existing service, client, adapter, schema, error or helper that already owns the behaviour, and extend it when the new method shares its reason to change.
2. Use a concrete client privately inside the service that owns its use, translating its failures before they leave. `PriceFeed` holds its `HttpClient` this way.
3. Extract an adapter when it hides real translation or mechanics, is used by more than one owner, or has more than one real implementation.
4. Apply the **deletion test**: the abstraction stays only if removing it would spread meaningful complexity into its callers.

A helper extracted to shorten a function keeps the exact inputs, failure union, requirements and transaction scope of the code it came from. Fewer branches alone do not justify a forwarding helper, an option bag or a dispatch table.

## Names

- A capability is named for what it is, in vocabulary that stays true for every caller: `UserStore`, `EmailSender`, `PriceFeed`. The specific behaviour goes in the operation name: `findActiveByEmail`, `sendPasswordReset`.
- The consumer stays out of the capability's name. `UsersForPasswordReset` is `UserStore` with one more method.
- `Repository`, `Gateway`, `Provider`, `Manager` and `Port` appear only when the word is the thing's real meaning.
- An implementation is qualified by the shortest distinction that matters: `layerPostgres`, `layerMemory`, `SystemClock`.
- A variable is named for what it holds: `const feed = yield* PriceFeed`.
- A name that a change makes inaccurate is renamed in that change.

## Contracts

- A service's public contract uses application and domain types. Framework, ORM, vendor SDK and runtime types stop at the adapter that owns them.
- A dependency is a yielded service object. A callback parameter is right only when higher-order behaviour is the capability itself.
- Authorization evidence, scoped handles and other per-operation values are explicit arguments, because they are part of the request.
- Keep the types an owner already established. Search the owning schema or public type before writing a local approximation; `unknown` and broad records belong only where the representation really is unknown.
- Resolve optionality before the call that needs the value. `Partial<T>` only when partiality is the domain concept.
- The primary input is positional. A named options object appears when real callers choose between policies; a boolean that changes behaviour becomes a named option with literal values (`{ verification: "skip" }`).
- State that allows different data or operations per stage is a tagged union. See [schema](SCHEMA.md).
- Values are `readonly`. Mutation stays inside an adapter, a builder or a measured hot path, behind a precise interface.
- Uncertainty about a type is resolved by branching, decoding or a more precise signature. A cast needs runtime evidence TypeScript cannot express, sits at its smallest owner, and carries `// SAFETY:` with that evidence. A value is never widened and asserted back, and optional values are narrowed instead of asserted non-null.
- When extracting a helper, check that the success, failure and requirement types of its callers did not widen.

## Authentication and authorization

- An inbound adapter verifies credentials and produces a parsed actor (`CurrentOrganization`, a session).
- A domain module holds the pure permission decision over parsed values.
- The application service gathers context and enforces the decision while it does the work.
- The adapter turns "no credentials" and "denied" into the protocol's outcome.

## Files and imports

- A file owns one concept and is named for it (`invoice-allocation.ts`, `live-horizon.ts`), so a search for the concept finds the file.
- Import from the file that owns the symbol. A re-export exists only as a deliberate package entry point.
- Type-only edges use `import type` and `export type`.
- Imports are inert. Reading configuration, opening a connection, registering a handler and starting a fiber happen in an entry point or a layer, never when a module loads.
- `import()` marks a lazy-loading or code-splitting boundary, such as keeping a module off the cold-start path.
- Export only what a caller outside the file uses.
