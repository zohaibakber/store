# Configuration, secrets and diagnostics

## Configuration

Configuration is read once, at the composition root or in the layer that owns the value, parsed into typed values, and passed inward. Inner code never reads the environment.

```ts
export const MailConfig = Config.all({
  apiKey: Config.Redacted("MAIL_API_KEY"),
  sender: Config.schema(Schema.NonEmptyString, "MAIL_SENDER"),
  replyTo: Config.option(Config.String("MAIL_REPLY_TO")),
  sandbox: Config.Boolean("MAIL_SANDBOX").pipe(Config.withDefault(false)),
  timeout: Config.Duration("MAIL_TIMEOUT").pipe(Config.withDefault(Duration.seconds(10))),
});
```

- A `Config` is yieldable: `const config = yield* MailConfig`.
- Typed recipes: `Config.String`, `Config.Int`, `Config.Boolean`, `Config.Duration`, `Config.URL`, `Config.Port`, `Config.Literals`, and `Config.schema(Schema, name)` for anything refined.
- `Config.Redacted` for every credential.
- `Config.option` when absence means something. `Config.withDefault` supplies a default for a missing value only; a malformed value still fails.
- `Config.orElse` falls back on any failure, including a malformed value. Use it only when that is the intent.
- A layer chosen or configured by config is `Layer.unwrap(Effect.gen(...))`. See [services and layers](SERVICES_LAYERS.md).
- A layer factory takes decoded options: `X.layer(options)`. Add a `layerConfig(config: Config.Wrap<Options>)` variant, built with `Config.unwrap`, only when a caller composes `Config` recipes.
- A configuration failure is a typed `ConfigError`. The composition root reports it without printing values and stops startup.

Providers:

- The default reads the environment (`ConfigProvider.fromEnv()`).
- `ConfigProvider.layer(provider)` replaces it for an app or a test suite: `ConfigProvider.layer(ConfigProvider.fromUnknown({ MAIL_API_KEY: "test" }))`.
- `ConfigProvider.layerAdd(provider)` adds a fallback; `{ asPrimary: true }` makes it override.
- `ConfigProvider.nested("prefix")` scopes a provider; `ConfigProvider.constantCase` maps camelCase keys to `SCREAMING_SNAKE_CASE`.

In an Alchemy Worker, bindings and secrets are read in the constructor's outer effect. See [Alchemy](ALCHEMY.md).

## Secrets

A token, API key, password, pepper or client secret is `Redacted.Redacted<string>` from the boundary where it enters (`Config.Redacted`, `Schema.Redacted`) through every layer of application code. `Redacted.value` is called in the one module that performs the final I/O with it. A redacted value prints as `<redacted>`.

`Schema.Defect()` carries a cause; it redacts nothing. Keep raw causes internal, and build wire errors from safe fields.

## Diagnostics

- Log through `Effect.log*` with a stable event name and structured fields: `Effect.logWarning("prices.refresh_failed").pipe(Effect.annotateLogs({ operation }))`. The name is searchable; the data is in the annotations.
- Useful fields: opaque ids approved for diagnostics, the operation, the provider, a state tag, a retry count, the error tag, a bounded summary built from allowlisted fields.
- `Effect.fn("Service.method")` gives every method a span. Add attributes with `Effect.annotateCurrentSpan`. Trace context is carried by the fiber, so keep work inside Effect across a boundary and it stays connected.
- Personal data is private by default. Record only the fields the project already records for that purpose.
- Errors, logs, spans, reports and snapshots contain redacted secrets only.
- Automatic instrumentation captures things application code never logs: HTTP spans can hold full URLs, headers, redirect locations and causes. Redact at the owner that creates or reports the event (the HTTP client layer, the error reporter), and check the emitted event with a representative sensitive input.
- Keep the existing logging, tracing and error-reporting hooks connected when you move code.
