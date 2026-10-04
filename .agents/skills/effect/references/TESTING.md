# Testing

Which tests a project commits is its own policy. This file is how a test of Effect code is written, kept or not.

## Shape

```ts
import { describe, expect, it, layer } from "@effect/vitest";

const pen = ProductId.make("pen");

const feed = Layer.mock(PriceFeed, {
  priceOf: (id) => (id === pen ? Effect.succeed(40) : Effect.fail(new UnknownProduct({ id }))),
});

layer(Quotes.layer.pipe(Layer.provide(feed)))("Quotes", (it) => {
  it.effect("multiplies the unit price", () =>
    Effect.gen(function* () {
      const quotes = yield* Quotes;
      expect(yield* quotes.quote(pen, 3)).toBe(120);
    }),
  );

  it.effect("keeps an unknown product typed", () =>
    Effect.gen(function* () {
      const quotes = yield* Quotes;
      const failure = yield* Effect.flip(quotes.quote(ProductId.make("ink"), 1));
      expect(failure._tag).toBe("UnknownProduct");
    }),
  );
});
```

- `it.effect` runs an effect with the test clock and a scope. `it.live` uses the real clock and is for behaviour that depends on real time or real I/O events.
- `layer(L)("name", (it) => ...)` builds `L` once for the block and tears it down afterwards. State in it is shared between the block's tests, so a test that needs a clean instance provides `Layer.fresh(L)` itself.
- The test file calls no `Effect.runPromise`. A helper that needs services returns an effect.

## What to exercise

Test at the highest real interface that runs reliably: the public entry point (an HTTP handler through its typed client, an RPC through `RpcTest.makeClient`, a host facade), then a service through its layer, then a pure domain module directly.

Assert what a caller or operator can observe: returned values and typed failures by tag, persisted state, emitted events, the rendered response. A spy on an internal method asserts the implementation; a recording double's public record asserts the behaviour.

Worth asserting: what happens on interruption and at scope close, retry bounds, idempotency of a replayed command, and that a rejected import or migration wrote nothing. Assertions that mirror the implementation line by line are the throwaway kind.

For durable work, pause execution with `Deferred` at the commit boundaries. Exercise a failed acceptance, a committed request with no execution yet, a remote success with no local receipt yet, and cancellation racing a late result. Reopen over the persisted state and check identity, visible state and external effects. Compare full replay with checkpoint plus suffix, including state first read after recovery. The [durability reference](DURABILITY.md) defines the expected outcomes. A formal model can check the abstract transitions; the implementation still needs these checks through its real storage and service boundaries.

## Real services, doubles at the true boundaries

- Run the real service through its real layer. Replace only what leaves the process: the network, another process, a paid provider.
- Replacement goes through layers. `vi.mock` and other module mocking are out: they bypass the interface the production caller uses.
- `Layer.mock(Service, { method })` supplies the methods a test uses; any other method dies if called, which catches an unexpected dependency.
- A service whose dependency should be replaceable leaves it open on its layer (see [services and layers](SERVICES_LAYERS.md)); the test provides the double, production provides the real one.
- Storage is real: SQLite in memory with the real migrations, or the project's database harness. Rebuilding a service over the same database shows persistence; it does not show recovery from a real process restart.
- HTTP handlers are tested in process through the typed client from `HttpApiTest`, and RPC handlers through `RpcTest.makeClient(Rpcs)`, against the real handler layer.
- Configuration comes from `ConfigProvider.layer(ConfigProvider.fromUnknown({...}))`.
- A double is named for what it does: `layerMemory`, `RecordingMailer`, `FailingMailer`. "In-memory" is claimed only by one that keeps the whole observable contract.
- Production code gains no branch, flag or export for a test's sake.

## A double the test controls

When a test needs to inspect or steer a double, one object is published under two tags: the production tag, which the code under test uses, and a control tag, which only the test yields.

```ts
export class MailerTest extends Context.Service<
  MailerTest,
  Mailer["Service"] & {
    readonly sent: Effect.Effect<ReadonlyArray<Message>>;
    readonly failNext: (error: MailError) => Effect.Effect<void>;
  }
>()("@acme/mail/MailerTest") {
  static readonly layer = Layer.effectContext(
    Effect.gen(function* () {
      const sent = yield* Ref.make<ReadonlyArray<Message>>([]);
      const next = yield* Ref.make(Option.none<MailError>());
      const service = MailerTest.of({
        send: Effect.fn("MailerTest.send")(function* (message) {
          const failure = yield* Ref.getAndSet(next, Option.none());
          if (Option.isSome(failure)) return yield* failure.value;
          yield* Ref.update(sent, (messages) => [...messages, message]);
        }),
        sent: Ref.get(sent),
        failNext: (error) => Ref.set(next, Option.some(error)),
      });
      return Context.empty().pipe(Context.add(Mailer, service), Context.add(MailerTest, service));
    }),
  );
}

it.effect("records what was sent and injects a failure", () =>
  Effect.gen(function* () {
    const mailer = yield* Mailer;
    const control = yield* MailerTest;
    yield* mailer.send({ to: "a@example.test", body: "hi" });
    yield* control.failNext(new MailError({ operation: "send", cause: "down" }));
    const failure = yield* Effect.flip(mailer.send({ to: "b@example.test", body: "yo" }));
    expect(failure._tag).toBe("MailError");
    expect(yield* control.sent).toHaveLength(1);
  }).pipe(Effect.provide(MailerTest.layer)),
);
```

Test controls live on the control tag. The production interface carries only what production callers need.

## Time and synchronisation

```ts
it.effect("waits on a signal, then moves the clock", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const fiber = yield* Deferred.succeed(started, undefined).pipe(
      Effect.andThen(Effect.sleep("7 hours")),
      Effect.as("done"),
      Effect.forkChild,
    );
    yield* Deferred.await(started);
    yield* TestClock.adjust("7 hours");
    expect(yield* Fiber.join(fiber)).toBe("done");
  }),
);
```

- Fork the effect that sleeps, wait for a signal that it has started, then `TestClock.adjust`. Schedules, retries, timeouts and TTLs all follow the test clock.
- Wait on a `Deferred` (one-shot), a `Queue` (hand-off), a `Latch` (a reusable gate) or a stream value. A sleep used to "let the fiber get there" races the scheduler and fails under load.
- Production code makes this possible: a worker exposes `drain` or `runOnce`, a milestone is a `Deferred`, and the clock, randomness and ids come from Effect services. Code that calls `Date.now()` or the `crypto` global cannot be driven this way.
- Stream fixtures are in [streams](STREAMS.md).

## Properties

An invariant, a round trip, a normalization, an ordering or a state transition is a property. `it.effect.prop` generates inputs from the Schemas themselves:

```ts
const Quantity = Schema.Int.check(Schema.isGreaterThan(0));

it.effect.prop("quantity survives a JSON round trip", [Quantity], ([quantity]) =>
  Effect.gen(function* () {
    const text = yield* Schema.encodeEffect(Schema.fromJsonString(Quantity))(quantity);
    expect(yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Quantity))(text)).toBe(quantity);
  }),
);
```

Valid data comes from the production schema or constructor. A rejection test builds the invalid representation by hand, independent of the schema under test, and sends it through the real boundary; otherwise removing the refinement would weaken the fixture with it.

Test the transformations, cross-field rules and failure behaviour the application owns. A test that a `Schema.Struct` rejects a missing field tests Effect.
