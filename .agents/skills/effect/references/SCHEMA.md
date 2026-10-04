# Schema

Everything that crosses a process, the network, storage or JSON text has a Schema, and the Schema is the single definition of the type.

## Provenance decides the parser

| What the producer hands you | What to do |
| --- | --- |
| A raw body, a SQL row, native storage, an untyped callback | Decode at the owning boundary into the strongest meaningful type (`decodeUnknownEffect`). |
| A known encoded representation, such as a `string` or a schema's encoded type | Keep the input type and validate the contents (`Schema.decodeEffect`). |
| A value already parsed into a domain type | Pass it through. Decoding it again, or encoding it to decode it, adds work and proves nothing. |
| A value you just computed or patched | Establish what is still unproven (a range, a cross-field rule, a legal transition) with the owning constructor: `X.make`, or `X.makeEffect` to keep the failure in `E`. |

- A SQL generic, a library's type declaration and `satisfies` are compile-time claims. They do not prove what arrived at runtime.
- Decode wherever less-trusted data re-enters typed code: database reads, cache hits, RPC responses, consumed events, rehydrated state. A check at write time does not prove the stored bytes are still valid.
- On a measured hot path, a documented trust invariant may replace the read-time decode. The unchecked representation then stays inside the module that owns it.
- A boundary whose shape differs from the application input (naming, encoding, optionality) gets its own schema, named for what it is (`CreateUserRequest`, `UserRow`), kept inside the boundary, and translated before inner code sees it. When the shapes mean the same thing, decode straight into the application type.

## Where contracts live

- Wire contracts shared by several processes live in a contract package with no server or client code: branded IDs, protocol payloads, the API definition, the wire errors.
- IPC and RPC schemas that serve one protocol sit beside that protocol.

A new wire shape goes in the contract package its consumers already import. The server and the client import the same definition. The project profile names the packages.

## Records

```ts
export const QuoteLine = Schema.Struct({
  productId: ProductId,
  quantity: Schema.Int.check(Schema.isGreaterThan(0)),
  note: Schema.optionalKey(Schema.String),
});
export type QuoteLine = typeof QuoteLine.Type;
```

- Data is `Schema.Struct` with a same-name type alias. `Schema.Class` is for errors only.
- `Schema.optionalKey` for a key that may be absent. `Schema.optional` only when an explicit `undefined` is part of the contract. `Schema.NullOr` only when the encoded form really carries `null`.
- Refine with `.check(Schema.isGreaterThan(0), Schema.isMaxLength(320))`.
- Reuse fields between contracts that mean the same thing: `User.fields.name`, `User.pipe(Schema.fieldsAssign({...}))`, `User.mapFields(...)`, with `Struct.omit` and `Struct.pick` for subsets. Write an explicit mapping when behaviour, joins or translation are involved.
- `Schema.encodeKeys({ name: "display_name" })` when only the key names differ between the decoded and encoded forms.
- A value with a default is a required field after decoding; the default is applied by the decoder or constructor.
- Build a trusted value with `QuoteLine.make({...})`; it validates. `QuoteLine.makeEffect` keeps the failure in `E`.
- `.annotate({ identifier: "QuoteLine" })` only when tooling reads it: `HttpApi`, `Rpc`, JSON Schema, diagnostics.

## IDs

```ts
export const ProductId = Schema.NonEmptyString.pipe(Schema.brand("ProductId"));
export type ProductId = typeof ProductId.Type;
export const decodeProductId = Schema.decodeUnknownSync(ProductId);
```

Every identifier is a branded string, defined once in the contract package. A function that takes a `ProductId` cannot be handed an `OrderId` or a raw string. Brand names are unique across the workspace.

Brand whatever could be mixed up or carries a rule: units (`Milliseconds`, `Cents`), and strings and numbers with real constraints (`EmailAddress`, `Slug`, `PositiveInt`). Apply the checks, then `Schema.brand`. Display text, local counters and indexes stay primitives until they gain a rule.

## Unions

```ts
export const QuoteCommand = Schema.TaggedUnion({
  add: { line: QuoteLine },
  clear: {},
});
export type QuoteCommand = typeof QuoteCommand.Type;

export const describe = (command: QuoteCommand): string => {
  switch (command._tag) {
    case "add":
      return `add ${command.line.quantity}`;
    case "clear":
      return "clear";
  }
};
```

- `Schema.TaggedUnion` for a `_tag` union that is decoded, stored or sent. `Schema.Union([Schema.TaggedStruct("a", {...}), ...])` when the members exist separately. `Schema.Literals([...])` for a closed set of strings.
- Consume a union with a `switch` on `_tag` that has a declared return type and no `default`, or a `never` guard. Either makes a new member a compile error.
- `TaggedUnion` also gives constructors and an exhaustive matcher: `QuoteCommand.cases.add.make({ line })`, `QuoteCommand.match(command, { add: ..., clear: ... })`.
- An external contract with its own discriminator (`type`, `kind`) uses `Schema.tag` on each struct and `Schema.toTaggedUnion("type")`. `Schema.tagDefaultOmit` is for an encoded form that leaves the discriminator out.
- An internal union that never leaves the process is a plain `_tag` union, or `Data.TaggedEnum` when it is built in several places or matched as an expression: `Data.taggedEnum<Step>()` gives `Step.Continue({...})`, `Step.$is` and an exhaustive `Step.$match`.
- State that allows different data or operations per stage (`Draft`, `Sent`, `Paid`) is a tagged union, so an illegal combination cannot be built. A status literal with one transition function is enough when the stages differ only by name.
- Internal unions are closed and handled exhaustively. An external protocol that may send a variant you do not know gets an explicit, tested fallback.

## Decoding

```ts
const decodeCommand = Schema.decodeUnknownEffect(Schema.fromJsonString(QuoteCommand));

export const parseCommand = (text: string) =>
  decodeCommand(text).pipe(
    Effect.mapError((issue) => new MalformedCommand({ message: issue.message })),
  );
```

- Build the decoder once at module scope and reuse it. Compiling a schema per call is wasted work on a hot path.
- Keep the decoder private to the boundary that owns it. What a module exports is a narrow parser with the real input type, such as `parseCommand(text: string)`, so library parse options stay out of the public surface.
- Names carry meaning: `parseX` takes untrusted or less-structured input, `makeX` builds from typed pieces, `isX` is a predicate.
- JSON text is `Schema.fromJsonString(X)`. Application code has no `JSON.parse`.
- Pick the decoder by what the caller does with a mismatch:
  - `decodeUnknownEffect`: inside Effect, the failure is mapped to a tagged error.
  - `decodeUnknownOption`: a mismatch means "absent".
  - `decodeUnknownResult`: pure code that wants success or failure.
  - `decodeUnknownSync`: module-level constants and Promise edges, where a throw is the right outcome.
  - `Schema.is(X)`: a type guard.
- SQL rows are decoded like any other input: `Schema.Array(Schema.Struct({...}))` with the failure mapped to the storage error.
- A cast on data needs `// SAFETY:` and a reason. Decoding is almost always the answer instead.

## Secrets

A token, pepper, password or client secret is `Redacted.Redacted<string>` from the moment it is read (`Config.Redacted`, `Schema.Redacted`) until the one call that needs `Redacted.value`. A redacted value prints as `<redacted>` in logs and errors.

## Guards

Runtime checks on `unknown` use `Predicate` (`Predicate.isObject`, `Predicate.isString`, `Predicate.hasProperty`) or `Schema.is`. A local `isRecord` helper duplicates them.
