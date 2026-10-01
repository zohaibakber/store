import { describe, expect, it } from "@effect/vitest";
import {
  OrgCommitSequence,
  SnapshotId,
  SnapshotPartHash,
  SyncEpoch,
  OPERATIONAL_SUBSCRIPTION,
  type SnapshotManifest,
  type SnapshotPartPayload,
} from "@store/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";

import { recoverRequiredSnapshot, SNAPSHOT_PART_FETCH_CONCURRENCY } from "../src/recovery";
import type { ReplicaSnapshotImportStore } from "../src/replica/store";
import { stubTransport } from "./lib/engine-fixture";

const acquireRequest = {
  epoch: SyncEpoch.make("1"),
  subscription: OPERATIONAL_SUBSCRIPTION,
};

describe("snapshot recovery", () => {
  it.effect("fetches parts concurrently and still imports them in manifest order", () =>
    Effect.gen(function* () {
      const wave = SNAPSHOT_PART_FETCH_CONCURRENCY;
      const manifest = manifestWithParts(wave * 2);
      const firstParts = Array.from({ length: wave }, (_, index) => index + 1);
      const secondParts = firstParts.map((partNumber) => partNumber + wave);
      const started = yield* Queue.unbounded<number>();
      const releases = new Map<number, Deferred.Deferred<void>>();
      for (const part of manifest.parts)
        releases.set(part.partNumber, yield* Deferred.make<void>());
      const transport = stubTransport({
        acquireSnapshot: () => Effect.succeed({ _tag: "ready" as const, manifest }),
        readSnapshotPart: (snapshotId, partNumber) =>
          Queue.offer(started, partNumber).pipe(
            Effect.andThen(Deferred.await(releases.get(partNumber) ?? Deferred.makeUnsafe<void>())),
            Effect.as(partPayload(snapshotId, partNumber)),
          ),
      });
      const store = recordingImportStore(0);
      const recovery = yield* Effect.forkChild(
        recoverRequiredSnapshot(transport, store, acquireRequest),
      );
      const takeWave = Effect.replicateEffect(Queue.take(started), SNAPSHOT_PART_FETCH_CONCURRENCY);
      const release = (partNumbers: ReadonlyArray<number>) =>
        Effect.forEach(
          partNumbers,
          (partNumber) => {
            const deferred = releases.get(partNumber);
            return deferred === undefined ? Effect.void : Deferred.succeed(deferred, undefined);
          },
          { discard: true },
        );
      const firstWave = yield* takeWave;
      expect([...firstWave].sort((left, right) => left - right)).toEqual(firstParts);
      yield* release([...firstParts].reverse());
      const secondWave = yield* takeWave;
      expect([...secondWave].sort((left, right) => left - right)).toEqual(secondParts);
      yield* release([...secondParts].reverse());
      yield* Fiber.join(recovery);
      expect(store.imported).toEqual([...firstParts, ...secondParts]);
      expect(store.activated).toEqual([manifest.snapshotId]);
    }),
  );

  it.effect("resumes a partly staged snapshot without refetching staged parts", () =>
    Effect.gen(function* () {
      const manifest = manifestWithParts(4);
      const fetched: Array<number> = [];
      const transport = stubTransport({
        acquireSnapshot: () => Effect.succeed({ _tag: "ready" as const, manifest }),
        readSnapshotPart: (snapshotId, partNumber) =>
          Effect.sync(() => {
            fetched.push(partNumber);
            return partPayload(snapshotId, partNumber);
          }),
      });
      const store = recordingImportStore(2);
      yield* recoverRequiredSnapshot(transport, store, acquireRequest);
      expect(fetched.sort((left, right) => left - right)).toEqual([3, 4]);
      expect(store.imported).toEqual([3, 4]);
      expect(store.activated).toEqual([manifest.snapshotId]);
    }),
  );
});

const manifestWithParts = (count: number): SnapshotManifest => ({
  snapshotId: SnapshotId.make("snapshot-parts"),
  epoch: SyncEpoch.make("1"),
  subscription: OPERATIONAL_SUBSCRIPTION,
  schemaVersion: 1,
  horizon: OrgCommitSequence.make("9"),
  parts: Array.from({ length: count }, (_, index) => ({
    partNumber: index + 1,
    byteLength: 1,
    sha256: SnapshotPartHash.make("a".repeat(64)),
  })),
  entityCounts: [],
  digestVersion: 3,
});

const partPayload = (snapshotId: SnapshotId, partNumber: number): SnapshotPartPayload => ({
  snapshotId,
  partNumber,
  rows: [],
});

const recordingImportStore = (partsImported: number) => {
  const imported: Array<number> = [];
  const activated: Array<string> = [];
  const store: ReplicaSnapshotImportStore = {
    beginSnapshotImport: () => Effect.succeed({ partsImported }),
    importSnapshotPart: (_manifest, part) =>
      Effect.sync(() => {
        imported.push(part.partNumber);
      }),
    applyCandidateAuthority: () => Effect.succeed("0"),
    abandonSnapshot: () => Effect.void,
    activateSnapshot: (snapshotId) =>
      Effect.sync(() => {
        activated.push(snapshotId);
        return { value: { _tag: "activated" as const }, notice: undefined };
      }),
  };
  return { ...store, imported, activated };
};
