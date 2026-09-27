import {
  OrgCommitSequence,
  PartitionDigest,
  type SyncCoverage,
  type SyncPullResult,
  type SyncSubscription,
} from "@store/contracts";
import {
  batches,
  categories,
  pendingRowMarks,
  products,
  replicaCoverage,
} from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { decodeEntity, decodeSubscription } from "./codecs";
import {
  decideCoverageAfterPull,
  localPartitionDigest,
  type PartitionRowSource,
} from "./decisions";
import { ReplicaStorageError } from "./errors";
import type { ReplicaDb } from "./sql-client/drizzle";

type DigestVerification = {
  readonly verifiedAt: number | undefined;
};

export const loadCoverage = Effect.fn("ReplicaCoverage.loadCoverage")(function* (
  tx: ReplicaDb,
  subscription: SyncSubscription,
) {
  const row = yield* tx
    .select()
    .from(replicaCoverage)
    .where(eq(replicaCoverage.subscription, subscription))
    .get();
  if (!row) return undefined;
  const decoded = decodeSubscription(row.subscription);
  if (Option.isNone(decoded)) {
    return yield* Effect.fail(
      ReplicaStorageError.make({ message: "Replica coverage subscription is invalid." }),
    );
  }
  if (row.state === "awaiting_snapshot") {
    return { _tag: "awaitingSnapshot", subscription: decoded.value } satisfies SyncCoverage;
  }
  if (row.throughCommitSequence && row.digest) {
    return {
      _tag: "downloaded",
      subscription: decoded.value,
      throughCommitSequence: OrgCommitSequence.make(row.throughCommitSequence),
      digest: PartitionDigest.make(row.digest),
    } satisfies SyncCoverage;
  }
  return undefined;
});

const saveCoverage = Effect.fn("ReplicaCoverage.saveCoverage")(function* (
  tx: ReplicaDb,
  coverage: SyncCoverage,
) {
  if (coverage._tag === "awaitingSnapshot") {
    yield* tx
      .insert(replicaCoverage)
      .values({
        subscription: coverage.subscription,
        state: "awaiting_snapshot",
        throughCommitSequence: null,
        digest: null,
        verifiedAt: null,
      })
      .onConflictDoUpdate({
        target: replicaCoverage.subscription,
        set: {
          state: "awaiting_snapshot",
          throughCommitSequence: null,
          digest: null,
          verifiedAt: null,
        },
      });
    return;
  }
  yield* tx
    .insert(replicaCoverage)
    .values({
      subscription: coverage.subscription,
      state: "downloaded",
      throughCommitSequence: coverage.throughCommitSequence,
      digest: coverage.digest,
    })
    .onConflictDoUpdate({
      target: replicaCoverage.subscription,
      set: {
        state: "downloaded",
        throughCommitSequence: coverage.throughCommitSequence,
        digest: coverage.digest,
      },
    });
});

export const loadDigestVerification = Effect.fn("ReplicaCoverage.loadDigestVerification")(
  function* (tx: ReplicaDb, subscription: SyncSubscription) {
    const row = yield* tx
      .select()
      .from(replicaCoverage)
      .where(eq(replicaCoverage.subscription, subscription))
      .get();
    return { verifiedAt: row?.verifiedAt ?? undefined } satisfies DigestVerification;
  },
);

export const recordDigestVerification = Effect.fn("ReplicaCoverage.recordDigestVerification")(
  function* (tx: ReplicaDb, subscription: SyncSubscription, verifiedAt: number) {
    yield* tx
      .insert(replicaCoverage)
      .values({
        subscription,
        state: "downloaded",
        throughCommitSequence: null,
        digest: null,
        verifiedAt,
      })
      .onConflictDoUpdate({
        target: replicaCoverage.subscription,
        set: { verifiedAt },
      });
  },
);

export const markCoverageRepair = (tx: ReplicaDb, subscription: SyncSubscription) =>
  saveCoverage(tx, { _tag: "awaitingSnapshot", subscription });

const localDigestFor = Effect.fn("ReplicaCoverage.localDigestFor")(function* (
  tx: ReplicaDb,
  subscription: SyncSubscription,
) {
  const marks = yield* tx.select().from(pendingRowMarks).all();
  const categoryRows = yield* tx.select().from(categories).all();
  const productRows = yield* tx.select().from(products).all();
  const batchRows = yield* tx.select().from(batches).all();
  const sources: ReadonlyArray<PartitionRowSource> = [
    ...categoryRows.map((row) => ({ entity: "category" as const, row })),
    ...productRows.map((row) => ({ entity: "product" as const, row })),
    ...batchRows.map((row) => ({ entity: "batch" as const, row })),
  ];
  return localPartitionDigest(
    subscription,
    sources,
    marks.map((mark) => ({ entity: decodeEntity(mark.entity) })),
  );
});

export const updateCoverageFromPull = Effect.fn("ReplicaCoverage.updateCoverageFromPull")(
  function* (tx: ReplicaDb, pulled: SyncPullResult, appliedThrough: string) {
    const localDigest =
      pulled.digest === undefined ? undefined : yield* localDigestFor(tx, pulled.subscription);
    const next = decideCoverageAfterPull(localDigest, pulled.digest);
    if (next._tag === "repair") {
      yield* markCoverageRepair(tx, pulled.subscription);
    }
    if (next._tag === "record") {
      yield* saveCoverage(tx, {
        _tag: "downloaded",
        subscription: pulled.subscription,
        throughCommitSequence: OrgCommitSequence.make(appliedThrough),
        digest: next.digest,
      });
    }
    return {
      repairRequired: next._tag === "repair",
      digestVerified: next._tag === "record" && next.verified,
    };
  },
);
