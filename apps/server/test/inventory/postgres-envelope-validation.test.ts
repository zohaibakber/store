import * as PgClient from "@effect/sql-pg/PgClient";
import { SyncSubmitCommandRequest } from "@store/contracts";
import { lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";

let database: AuthorityPostgres;

const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        PgClient.layer({
          url: Redacted.make(database.connectionString),
          maxConnections: 2,
          applicationName: "tabaaq-envelope-validation-tests",
        }),
      ),
      Effect.scoped,
    ),
  );

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));
const isJsonObject = Schema.is(Schema.Record(Schema.String, Schema.Json));
const schemaAccepts = (candidate: Schema.Json) =>
  Option.isSome(Schema.decodeUnknownOption(SyncSubmitCommandRequest)(candidate));

const HASH = "a".repeat(64);

const envelope = (command: Schema.Json): Schema.Json => ({
  organizationId: "org-1",
  epoch: "1",
  replicaId: "replica-a",
  clientSequence: "3",
  operationId: "operation-1",
  payloadHash: HASH,
  afterCommitSequence: "2",
  maxBytes: 65_536,
  command,
});

const catalog = (writes: ReadonlyArray<Schema.Json>) =>
  envelope({
    _tag: "catalogWrite",
    payload: {
      commandId: "command-1",
      deviceId: "device-1",
      occurredAt: 1_700_000_000_000,
      writes,
    },
  });

const BASES: ReadonlyArray<readonly [string, Schema.Json]> = [
  [
    "invoice",
    decodeJson(
      Schema.encodeSync(Schema.fromJsonString(SyncSubmitCommandRequest))(lastUnitBuyerAEnvelope),
    ),
  ],
  [
    "category upsert",
    catalog([
      {
        entity: "category",
        action: "upsert",
        id: "category-1",
        expectedRowVersion: null,
        row: { name: "Tablets", tracksPacks: true },
      },
    ]),
  ],
  [
    "product upsert",
    catalog([
      {
        entity: "product",
        action: "upsert",
        id: "product-1",
        expectedRowVersion: 3,
        row: {
          name: "Paracetamol",
          categoryId: "category-1",
          aisle: null,
          composition: "500mg",
          strength: null,
          unitsPerPack: 10,
          purchasePrice: 100,
          retailPrice: null,
          unitPrice: 12,
          visible: true,
        },
      },
    ]),
  ],
  [
    "batch upsert",
    catalog([
      {
        entity: "batch",
        action: "upsert",
        id: "batch-1",
        expectedRowVersion: null,
        movementId: "movement-1",
        note: "restock",
        row: {
          productId: "product-1",
          batchNumber: "B-7",
          expiresAt: 1_800_000_000_000,
          packQuantity: 4,
          unitQuantity: 0,
        },
      },
    ]),
  ],
  [
    "deletes",
    catalog([
      { entity: "category", action: "delete", id: "category-2", expectedRowVersion: 1 },
      { entity: "product", action: "delete", id: "product-2", expectedRowVersion: 2 },
      { entity: "batch", action: "delete", id: "batch-2", expectedRowVersion: 5 },
    ]),
  ],
];

const REPLACEMENTS: ReadonlyArray<Schema.Json> = [
  null,
  "",
  " ",
  "x".repeat(201),
  "x".repeat(501),
  "12",
  "-1",
  "1.5",
  "unit",
  0,
  -1,
  1.5,
  2 ** 53,
  true,
  {},
  [],
];

type Step =
  | { readonly _tag: "index"; readonly index: number }
  | { readonly _tag: "key"; readonly key: string };
type Path = ReadonlyArray<Step>;

const leafPaths = (value: Schema.Json, path: Path = []): ReadonlyArray<Path> => {
  if (Array.isArray(value)) {
    return [
      path,
      ...value.flatMap((entry, index) => leafPaths(entry, [...path, { _tag: "index", index }])),
    ];
  }
  if (value !== null && isJsonObject(value)) {
    return [
      ...(path.length === 0 ? [] : [path]),
      ...Object.entries(value).flatMap(([key, entry]) =>
        leafPaths(entry, [...path, { _tag: "key", key }]),
      ),
    ];
  }
  return [path];
};

const replaceAt = (
  value: Schema.Json,
  path: Path,
  replacement: Option.Option<Schema.Json>,
): Option.Option<Schema.Json> => {
  const [head, ...rest] = path;
  if (head === undefined) return replacement;
  if (head._tag === "index" && Array.isArray(value)) {
    return Option.some(
      value.flatMap((entry, index) =>
        index === head.index ? Option.toArray(replaceAt(entry, rest, replacement)) : [entry],
      ),
    );
  }
  if (head._tag === "key" && value !== null && isJsonObject(value)) {
    const entries = Object.entries(value);
    const current = entries.find(([key]) => key === head.key)?.[1] ?? null;
    const others = entries.filter(([key]) => key !== head.key);
    return Option.some(
      Option.match(replaceAt(current, rest, replacement), {
        onNone: () => Object.fromEntries(others),
        onSome: (next) => Object.fromEntries([...others, [head.key, next]]),
      }),
    );
  }
  return Option.some(value);
};

const describePath = (path: Path) =>
  path.map((step) => (step._tag === "index" ? `[${step.index}]` : `.${step.key}`)).join("");

const candidatesFor = (base: Schema.Json) =>
  leafPaths(base).flatMap((path) =>
    [...REPLACEMENTS.map(Option.some), Option.none<Schema.Json>()].map((replacement) => ({
      path: describePath(path),
      replacement: Option.getOrElse(replacement, () => "<removed>"),
      value: Option.getOrElse(replaceAt(base, path, replacement), () => null),
    })),
  );

const sqlProblems = (values: ReadonlyArray<Schema.Json>) =>
  run(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const rows = yield* sql<{ readonly ordinal: string; readonly problem: string | null }>`
        select candidate.ordinal::text as ordinal, sync.submit_request_problem(candidate.value) as problem
        from jsonb_array_elements(${encodeJson(values)}::jsonb) with ordinality as candidate(value, ordinal)
        order by candidate.ordinal`;
      return rows.map((row) => row.problem);
    }),
  );

beforeAll(async () => {
  database = await startAuthorityPostgres();
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe("command envelope validation in Postgres", () => {
  it.each(BASES)(
    "accepts the valid %s envelope exactly like the contract schema",
    async (_, base) => {
      expect(schemaAccepts(base)).toBe(true);
      expect(await sqlProblems([base])).toEqual([null]);
    },
  );

  it.each(BASES)(
    "rejects exactly the %s mutations that the contract schema rejects",
    async (_, base) => {
      const candidates = candidatesFor(base);
      const problems = await sqlProblems(candidates.map((candidate) => candidate.value));
      const mismatches = candidates.flatMap((candidate, index) => {
        const schemaOk = schemaAccepts(candidate.value);
        const sqlOk = problems[index] === null;
        return schemaOk === sqlOk
          ? []
          : [
              {
                path: candidate.path,
                replacement: candidate.replacement,
                schemaOk,
                sqlProblem: problems[index],
              },
            ];
      });
      expect(candidates.length).toBeGreaterThan(100);
      expect(
        candidates.filter((candidate) => !schemaAccepts(candidate.value)).length,
      ).toBeGreaterThan(50);
      expect(mismatches).toEqual([]);
    },
    120_000,
  );
});
