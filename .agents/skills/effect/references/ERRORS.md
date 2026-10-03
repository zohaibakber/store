# Errors

## Declaring

```ts
export class PriceFeedError extends Schema.TaggedError<PriceFeedError>()("PriceFeedError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class InvalidQuantity extends Schema.TaggedError<InvalidQuantity>()("InvalidQuantity", {
  quantity: Schema.Finite,
}) {}
```

- Every error in `E` is a `Schema.TaggedError` class. A plain `Error`, a string or `unknown` in `E` is a bug in the signature.
- Fields are data a caller can branch on. A domain refusal carries a closed reason (`reason: Schema.Literals([...])`, as `AuthRefusal` does) instead of free text.
- An infrastructure error carries `operation` and `cause: Schema.Defect()`, so it stays serializable and keeps the original failure for logs.
- The tag is the class name, and the class name is specific enough to be unique in the workspace (`ReplicaStorageError`, not `StorageError`). A tag that already crosses a process boundary or is persisted is a contract: check every consumer before renaming it.
- One error with a tagged `reason` union replaces a family of near-identical classes. Handle a single reason with `Effect.catchReason("Parent", "Reason", ...)`. See `node_modules/effect/ai-docs/src/01_effect/04_errors/20_reason-errors.ts`.
- Keep distinct failure modes as distinct classes and union them at the operation: `export type QuoteFailure = PriceFeedError | UnknownProduct | InvalidQuantity`. Merge two only when every caller handles them the same way and the fields still say which one happened. A broad `AppError` belongs at an entry point, never on a service method.
- Every known failure is in the signature, even when the immediate caller cannot recover. It is handled or passed upward until a boundary turns it into an outcome: a response, a retry decision, a startup message.
- Absence follows the operation's meaning. "May not exist" returns `Option`. "Must exist" fails with a typed not-found.
- When an error has a `message`, the class that owns the failure writes it, starting with a fixed phrase a text search leads back to, followed by the dynamic part. Callers classify by tag and fields, never by matching message text, and a message is never derived from `cause`.

## Raising

- In a generator: `return yield* new UnknownProduct({ id })`. The `return` tells TypeScript the branch ends.
- In expression position (a ternary, a handler): `Effect.fail(new UnknownProduct({ id }))`.
- Construct with `new`.

## Translating foreign failures

Translate where the foreign call happens, into the owning service's error:

```ts
const failed = (operation: string) =>
  Effect.mapError((cause: unknown) => new PriceFeedError({ operation, cause }));
```

- A Promise API that can reject for an expected reason: `Effect.tryPromise({ try, catch: (cause) => new X({ cause }) })`.
- `Effect.promise` is for a call whose rejection would be a bug.
- A helper curried on the operation name keeps each call site to one word: `.pipe(failed("load"))`.

## Pure validation returns a Result

Pure code that can refuse returns `Result`, and Effect code lifts it:

```ts
export const decideQuantity = (quantity: number): Result.Result<number, InvalidQuantity> =>
  Number.isInteger(quantity) && quantity > 0
    ? Result.succeed(quantity)
    : Result.fail(new InvalidQuantity({ quantity }));

export const quoteLine = Effect.fn("Checkout.quoteLine")(function* (
  id: ProductId,
  requested: number,
) {
  const quotes = yield* Quotes;
  const quantity = yield* Effect.fromResult(decideQuantity(requested));
  return yield* quotes.quote(id, quantity);
});
```

`throw new Error(message)` in a projection, wrapped later by `Effect.try`, turns a user-facing refusal into `unknown`. `apps/desktop/electron/replica-admission.ts` and `decideCatalogRow` in `packages/sync/src/replica/projection.ts` show the `Result` form.

## Catching

```ts
export const quoteOrZero = (id: ProductId, requested: number) =>
  quoteLine(id, requested).pipe(Effect.catchTag("UnknownProduct", () => Effect.succeed(0)));
```

- `Effect.catchTag("Tag", handler)` for one tag, `Effect.catchTag(["A", "B"], handler)` for several with one handler, `Effect.catchTags({ A: ..., B: ... })` for several with different handlers.
- `Effect.catch` handles every typed failure. Use it where every remaining failure has the same truthful answer.
- Prefer explicit tags at a translation boundary: map each foreign failure by its meaning and let already-correct errors pass through untouched. A new tag then stays in the inferred `E`, and the compiler shows the policy nobody chose. `Effect.mapError` over the whole channel is right only when the whole channel has one meaning.
- Also available: `Effect.catchIf` for a predicate, `Effect.catchReason` for one reason of a parent error.
- Recover at the narrowest place that has a truthful answer, and leave the rest in `E`.
- `Effect.ignore` is for cleanup and best-effort work. Log before discarding a failure that someone would want to diagnose.
- Retry only an operation whose idempotency is established, and keep an exhausted retry visible as the failure. A lost response to a mutation is uncertainty, not failure. See [retry](RETRY.md).

## Crossing a boundary

A service knows nothing about HTTP status codes, IPC shapes or toast copy. The boundary maps its failures with a pure function over the union:

```ts
const wireStatus = (failure: QuoteFailure): number => {
  switch (failure._tag) {
    case "InvalidQuantity":
      return 400;
    case "UnknownProduct":
      return 404;
    case "PriceFeedError":
      return 503;
    default: {
      const _exhaustive: never = failure;
      return _exhaustive;
    }
  }
};
```

- The `never` guard makes a new error class a compile error at every boundary. A `default:` that returns a generic answer absorbs new cases silently.
- Wire errors are their own schemas in `@store/contracts` and `@store/auth` (`Schema.Struct` with `HttpApiSchema.status`), separate from the internal error, so internals and causes never reach a client.
- `apps/auth/src/failures.ts` is the model: a `REFUSALS` table plus an exhaustive switch, applied once per handler with `Effect.mapError`.
- Schema decode failures are transformed once, by `HttpApiMiddleware.layerSchemaErrorTransform`.

## Defects

- A failure the caller can act on stays typed. In this app that includes storage and network failures: the UI shows offline, retries, or asks the user to free space.
- `Effect.orDie` belongs at the owner of an infrastructure call when no caller could do anything except log, such as a startup invariant or a query whose only failure is a broken deployment. It keeps `SqlError` out of every signature above.
- `Effect.die` marks an impossible state: a violated internal invariant or an unreachable branch.
- A known configuration failure is a value; the composition root reports it and stops startup.
- Validation, authorization, missing rows, conflicts and busy states are never defects. A defect crossing an HTTP boundary becomes a generic 500 and the useful message is lost.

## The last resort

```ts
export const lastResort = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.logError("checkout.unexpected").pipe(
            Effect.annotateLogs({ cause: Cause.pretty(cause) }),
            Effect.as(500),
          ),
    ),
  );
```

`Effect.catchCause` appears at a supervisor and at the outermost handler of a process. It re-raises interruption, logs the full cause, and answers with a safe public body. `recoverUnexpected` in `apps/server/src/http/app.ts` is the house version.
