# Retry, repeat and doing work twice

## Schedule semantics

- `Effect.retry` re-runs typed failures. Defects and interruption pass through.
- `Effect.repeat` re-runs successes. A failure stops the repeat, so a worker handles its expected failures inside the repeated effect.
- The effect runs once before the schedule is consulted. `Schedule.recurs(3)` is three more runs after the first.
- `Schedule.spaced` waits after each run completes. `Schedule.fixed` holds a cadence. `Schedule.cron` follows a cron expression.
- `Schedule.exponential` and `Schedule.fibonacci` back off. `Schedule.jittered` spreads clients so they do not retry in step.
- Bound a delay schedule with `Schedule.upTo({ times })`; cap its delay with `Schedule.min([Schedule.exponential("250 millis"), Schedule.spaced("10 seconds")])`.
- `Schedule.while` filters by the failure. `Schedule.tap` observes each step.
- The short form covers most retries: `Effect.retry({ schedule, times, while })`.
- `Effect.retryOrElse` runs a fallback when the schedule is exhausted. Without it, the last failure stays in `E`, which is usually what the caller should see.

A delay table indexed by an attempt counter, and a hand-written jittered sleep, are a schedule written by hand.

## A reusable policy

```ts
export const mailRetry = Schedule.exponential("200 millis").pipe(
  Schedule.jittered,
  Schedule.upTo({ times: 5 }),
  Schedule.setInputType<MailError>(),
  Schedule.passthrough,
  Schedule.modifyDelay(({ input, duration }) =>
    Effect.succeed(
      input.retryAfterMillis === undefined
        ? duration
        : Duration.max(duration, Duration.millis(input.retryAfterMillis)),
    ),
  ),
);

export const deliverWithRetry = (message: Message) =>
  deliver(message).pipe(
    Effect.retry(mailRetry),
    Effect.tapError((error) =>
      Effect.logError("mail.delivery_stopped").pipe(
        Effect.annotateLogs({ operation: error.operation }),
      ),
    ),
  );
```

`Schedule.passthrough` makes the failure the schedule's output, so `modifyDelay` can honour a provider's retry-after hint while never retrying sooner than the backoff. The final `tapError` reports exhaustion and leaves the typed failure in place.

## Workers

A polling worker logs an expected pass failure and continues. A defect still reaches the supervisor.

```ts
export const worker = runPass.pipe(
  Effect.tapError((error) =>
    Effect.logWarning("outbox.pass_failed").pipe(
      Effect.annotateLogs({ operation: error.operation }),
    ),
  ),
  Effect.ignore,
  Effect.repeat(Schedule.spaced("1 second")),
);
```

A batch isolates each item, so one bad item does not stall the rest. This is truthful only when the item is retried later or deliberately skipped.

```ts
export const drain = (messages: ReadonlyArray<Message>) =>
  Effect.forEach(
    messages,
    (message) =>
      deliverWithRetry(message).pipe(
        Effect.tapError(() =>
          Effect.logWarning("outbox.item_failed").pipe(Effect.annotateLogs({ to: message.to })),
        ),
        Effect.ignore,
      ),
    { discard: true, concurrency: 5 },
  );
```

A supervisor whose policy is "report anything except interruption and keep going" uses `Effect.catchCauseIf((cause) => !Cause.hasInterrupts(cause), report)`. Nothing below a supervisor catches causes.

Fork the worker with `Effect.forkScoped` from a `Layer.effectDiscard`, and expose `drain` or `runOnce` so a test can run one pass without the loop. See [services and layers](SERVICES_LAYERS.md).

## Deadlines

- A real deadline: `Effect.timeoutOrElse({ duration, orElse })` for a typed failure, `Effect.timeoutOption` for absence.
- One operation that starts later: `Effect.delay`.
- Waiting that is itself the behaviour: `Effect.sleep`.

## Retrying something that has effects

A retry is correct only when running the operation twice is safe. Name the guarantee before adding the retry, and put it at the layer that owns the duplication:

- an **idempotency key** the caller supplies for the repeated request (a command's `operationId`);
- a **unique constraint** that already forbids the duplicate;
- a **deduplication record** for a redelivered message with a stable identity;
- a **state-machine guard**, where the current state decides whether the mutation may run;
- a **transactional outbox**, when a state change and the intent to publish must commit together;
- a **transactional inbox**, when deduplication and the resulting change must commit together.

Retry at the narrowest place that has the guarantee. `HttpClient.retryTransient` covers transport failures and 408, 429, 500, 502, 503 and 504 for idempotent requests; a retry that depends on a domain failure or a provider payload is an `Effect.retry` on the operation.

## Uncertain outcomes

A timeout, an interruption or a lost response does not show that a remote mutation failed. Model "unknown" as its own outcome and resolve it by reconciliation or by a retry the idempotency guarantee makes safe. A receipt is one such design: a command whose response was lost is resolved by asking for its receipt.

When undoing a remote commit must stay possible, persist the identity and the intent before the call. Receipts, outboxes, leases and checkpoints carry that evidence; a smaller workflow is no reason to remove one. Define the point of no return, so a failure in required work after the commit does not trigger a compensation that is no longer valid.

## Call, transaction or durable workflow

- No atomic change needed: an ordinary call.
- Changes in one datastore that commit or roll back together: `sql.withTransaction`. Close it before any network call or long-running work.
- Progress that must survive process loss, redelivery, long delays or several transaction boundaries: persisted state that a worker resumes, such as a durable command queue, or `effect/workflow` where the project has adopted it.

An in-memory `Schedule`, `Deferred` or scoped fiber carries no progress across a restart. Persist the operation identity, accepted input and recovery state when that is part of the contract. See [durability](DURABILITY.md) for commit ordering, recovery and cancellation.
