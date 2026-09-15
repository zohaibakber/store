import type { CommandReceipt, SyncCommandEnvelope, SyncPullRequest } from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { applyTransactionGroup } from "./replica/apply";
import {
  recordCommandReceipt,
  saveLocalCommand,
  takePendingCommand,
} from "./replica/commands";
import { runReplicaTransaction, type ReplicaDb } from "./replica/storage";
import type { SyncTransport } from "./transport";

export type SyncEngineProgress = {
  readonly uploading: boolean;
  readonly downloading: boolean;
};

export interface SyncEngineContract {
  readonly progress: SubscriptionRef.SubscriptionRef<SyncEngineProgress>;
  readonly saveCommand: (envelope: SyncCommandEnvelope, createdAt: number) => Effect.Effect<void>;
  readonly uploadOnce: () => Effect.Effect<CommandReceipt | undefined, unknown>;
  readonly downloadOnce: (request: SyncPullRequest) => Effect.Effect<void, unknown>;
}

export class SyncEngine extends Context.Service<SyncEngine, SyncEngineContract>()(
  "@store/sync/SyncEngine",
) {}

export const makeSyncEngine = (
  db: ReplicaDb,
  mutex: {
    readonly withPermits: (
      permits: number,
    ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  },
  transport: SyncTransport,
): Effect.Effect<SyncEngineContract> =>
  Effect.gen(function* () {
    const progress = yield* SubscriptionRef.make<SyncEngineProgress>({
      uploading: false,
      downloading: false,
    });
    const withPermit = <A>(run: (tx: ReplicaDb) => A) =>
      mutex.withPermits(1)(Effect.sync(() => runReplicaTransaction(db, run)));

    const saveCommand = Effect.fn("SyncEngine.saveCommand")(function* (
      envelope: SyncCommandEnvelope,
      createdAt: number,
    ) {
      yield* withPermit((tx) => {
        saveLocalCommand(tx, envelope, createdAt);
      });
    });

    const uploadOnce = Effect.fn("SyncEngine.uploadOnce")(function* () {
      const envelope = yield* withPermit((tx) => takePendingCommand(tx));
      if (!envelope) return undefined;
      yield* SubscriptionRef.update(progress, (current) => ({ ...current, uploading: true }));
      try {
        const receipt = yield* transport.submitCommand(envelope);
        yield* withPermit((tx) => recordCommandReceipt(tx, receipt));
        return receipt;
      } finally {
        yield* SubscriptionRef.update(progress, (current) => ({ ...current, uploading: false }));
      }
    });

    const downloadOnce = Effect.fn("SyncEngine.downloadOnce")(function* (request: SyncPullRequest) {
      yield* SubscriptionRef.update(progress, (current) => ({ ...current, downloading: true }));
      try {
        const pulled = yield* transport.pull(request);
        yield* withPermit((tx) => {
          for (const group of pulled.transactions) {
            applyTransactionGroup(tx, group);
          }
        });
      } finally {
        yield* SubscriptionRef.update(progress, (current) => ({ ...current, downloading: false }));
      }
    });

    return { progress, saveCommand, uploadOnce, downloadOnce };
  });
