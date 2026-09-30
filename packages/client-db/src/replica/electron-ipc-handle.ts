import {
  CommandStatus,
  EnqueueCommandRequest,
  InsightsContext,
  InsightsSummaryRead,
  ProductInsightsRead,
  ReplicaInsightsFacts,
  RestockPageRead,
  RestockPageRequest,
  SyncEntity,
  type ReplicaInsightsWindow,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { makeReplicaLifetime } from "./lifetime";
import { createReplicaCommitPublisher } from "./publisher";
import { decodeSqliteResultRow } from "./sqlite-row";
import type { ReplicaSyncHealth } from "./status";
import {
  InventorySubsetSummary,
  type InventorySubsetSpec,
  type InventorySubsetSummarySpec,
} from "./subset-spec";
import type {
  ReplicaAnalytics,
  ReplicaHandle,
  ReplicaQueryStamp,
  ReplicaReadOptions,
} from "./types";

export type ElectronReplicaOpenIdentity = {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
};

type CommitStamp = {
  readonly generationId: string;
  readonly localCommitVersion: number;
};

export type ElectronReplicaBridge = {
  readonly open: (
    identity: ElectronReplicaOpenIdentity,
  ) => Promise<{ readonly workspaceToken: string; readonly engine: "sqlite" | "unavailable" }>;
  readonly close: (workspaceToken: string) => Promise<void>;
  readonly stamp: (workspaceToken: string) => Promise<CommitStamp>;
  readonly readSubset: (input: {
    readonly workspaceToken: string;
    readonly requestId: string;
    readonly spec: InventorySubsetSpec;
  }) => Promise<{
    readonly rows: ReadonlyArray<Record<string, string | number | null>>;
    readonly stamp: CommitStamp;
  }>;
  readonly readBatch: (input: {
    readonly workspaceToken: string;
    readonly requestId: string;
    readonly specs: ReadonlyArray<InventorySubsetSpec>;
  }) => Promise<{
    readonly reads: ReadonlyArray<ReadonlyArray<Record<string, string | number | null>>>;
    readonly stamp: CommitStamp;
  }>;
  readonly cancelRead: (input: {
    readonly workspaceToken: string;
    readonly requestId: string;
  }) => Promise<void>;
  readonly retryRecovery: (workspaceToken: string) => Promise<void>;
  readonly summarizeSubset: (input: {
    readonly workspaceToken: string;
    readonly spec: InventorySubsetSummarySpec;
  }) => Promise<{
    readonly summary: InventorySubsetSummary;
    readonly stamp: CommitStamp;
  }>;
  readonly readInsights: (input: {
    readonly workspaceToken: string;
    readonly window: ReplicaInsightsWindow;
  }) => Promise<{
    readonly facts: typeof ReplicaInsightsFacts.Encoded;
    readonly stamp: CommitStamp;
  }>;
  readonly readInsightsSummary: (input: {
    readonly workspaceToken: string;
    readonly context: typeof InsightsContext.Encoded;
  }) => Promise<typeof InsightsSummaryRead.Encoded>;
  readonly readProductInsights: (input: {
    readonly workspaceToken: string;
    readonly context: typeof InsightsContext.Encoded;
    readonly ids: ReadonlyArray<string>;
  }) => Promise<typeof ProductInsightsRead.Encoded>;
  readonly readRestockPage: (input: {
    readonly workspaceToken: string;
    readonly context: typeof InsightsContext.Encoded;
    readonly request: typeof RestockPageRequest.Encoded;
  }) => Promise<typeof RestockPageRead.Encoded>;
  readonly onAnalytics: (
    callback: (event: {
      readonly workspaceToken: string;
      readonly revision: number;
      readonly state: "idle" | "building" | "refreshing";
      readonly progress: { readonly done: number; readonly total: number } | null;
    }) => void,
  ) => () => void;
  readonly onCommit: (
    callback: (event: {
      readonly workspaceToken: string;
      readonly generationId: string;
      readonly localCommitVersion: number;
      readonly touchedEntities: ReadonlyArray<string>;
      readonly touchedKeys: ReadonlyArray<string>;
      readonly fullInvalidation?: boolean;
      readonly overflowedEntities?: ReadonlyArray<string>;
    }) => void,
  ) => () => void;
  readonly onSyncHealth: (
    workspaceToken: string,
    callback: (health: ReplicaSyncHealth) => void,
  ) => () => void;
  readonly readOutboxStatuses: (workspaceToken: string) => Promise<ReadonlyArray<string>>;
  readonly enqueueCommand: (input: {
    readonly workspaceToken: string;
    readonly request: typeof EnqueueCommandRequest.Encoded;
  }) => Promise<{
    readonly operationId: string;
    readonly status: string;
    readonly stamp: CommitStamp;
  }>;
  readonly readCommandStatus: (input: {
    readonly workspaceToken: string;
    readonly operationId: string;
  }) => Promise<string | null>;
  readonly wakeSyncUpload: (workspaceToken: string) => Promise<{
    readonly drained: boolean;
    readonly drainCount: number;
  }>;
};

const decodeSummary = Schema.decodeUnknownSync(InventorySubsetSummary);
const decodeInsightsFacts = Schema.decodeUnknownSync(ReplicaInsightsFacts);
const decodeSummaryRead = Schema.decodeUnknownSync(InsightsSummaryRead);
const decodeProductsRead = Schema.decodeUnknownSync(ProductInsightsRead);
const decodeRestockRead = Schema.decodeUnknownSync(RestockPageRead);
const encodeContext = Schema.encodeSync(InsightsContext);
const encodeRestockRequest = Schema.encodeSync(RestockPageRequest);
const decodeSyncEntity = Schema.decodeUnknownOption(SyncEntity);
const decodeCommandStatus = Schema.decodeUnknownOption(CommandStatus);
const encodeEnqueueRequest = Schema.encodeSync(EnqueueCommandRequest);
const decodeQueuedCommandStatus = Schema.decodeUnknownSync(CommandStatus);

const decodedSome = <A>(
  values: ReadonlyArray<string>,
  decode: (value: string) => Option.Option<A>,
) => values.flatMap((value) => Option.toArray(decode(value)));

export const openElectronIpcReplicaHandle = async (
  bridge: ElectronReplicaBridge,
  identity: ElectronReplicaOpenIdentity,
): Promise<ReplicaHandle> => {
  const opened = await bridge.open(identity);
  const { workspaceToken } = opened;
  if (opened.engine !== "sqlite") {
    await bridge.close(workspaceToken).catch(() => undefined);
    throw new Error("Native Electron replica SQLite is unavailable.");
  }

  const publisher = createReplicaCommitPublisher();
  const lifetime = makeReplicaLifetime();
  lifetime.onClose(Effect.promise(() => bridge.close(workspaceToken).catch(() => undefined)));
  lifetime.onClose(Effect.promise(() => publisher.dispose()));

  const unsubscribeCommits = bridge.onCommit((event) => {
    if (event.workspaceToken !== workspaceToken) return;
    publisher.publish(
      Object.assign(
        {
          workspaceToken,
          generationId: event.generationId,
          localCommitVersion: event.localCommitVersion,
          touchedEntities: decodedSome(event.touchedEntities, decodeSyncEntity),
          touchedKeys: event.touchedKeys,
        },
        event.fullInvalidation === undefined
          ? undefined
          : { fullInvalidation: event.fullInvalidation },
        event.overflowedEntities === undefined
          ? undefined
          : { overflowedEntities: decodedSome(event.overflowedEntities, decodeSyncEntity) },
      ),
    );
  });
  lifetime.onClose(Effect.sync(unsubscribeCommits));

  const analyticsListeners = new Set<Parameters<ReplicaAnalytics["subscribe"]>[0]>();
  const unsubscribeAnalytics = bridge.onAnalytics((event) => {
    if (event.workspaceToken !== workspaceToken) return;
    for (const listener of analyticsListeners) {
      listener({ revision: event.revision, state: event.state, progress: event.progress });
    }
  });
  lifetime.onClose(Effect.sync(unsubscribeAnalytics));

  const analytics: ReplicaAnalytics = {
    readSummary: async (context) =>
      decodeSummaryRead(
        await bridge.readInsightsSummary({ workspaceToken, context: encodeContext(context) }),
      ),
    readProducts: async (context, ids) =>
      decodeProductsRead(
        await bridge.readProductInsights({
          workspaceToken,
          context: encodeContext(context),
          ids,
        }),
      ),
    readRestockPage: async (context, request) =>
      decodeRestockRead(
        await bridge.readRestockPage({
          workspaceToken,
          context: encodeContext(context),
          request: encodeRestockRequest(request),
        }),
      ),
    subscribe: (listener) => {
      analyticsListeners.add(listener);
      return () => {
        analyticsListeners.delete(listener);
      };
    },
  };

  const workspaceStamp = (value: CommitStamp): ReplicaQueryStamp => ({
    workspaceToken,
    generationId: value.generationId,
    localCommitVersion: value.localCommitVersion,
  });

  const cancellable = <A>(
    start: (requestId: string) => Promise<A>,
    options: ReplicaReadOptions | undefined,
  ): Promise<A> =>
    Effect.runPromise(
      Effect.suspend(() => {
        const requestId = crypto.randomUUID();
        return Effect.tryPromise({ try: () => start(requestId), catch: (cause) => cause }).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              void bridge.cancelRead({ workspaceToken, requestId }).catch(() => undefined);
            }),
          ),
        );
      }),
      options?.signal === undefined ? undefined : { signal: options.signal },
    );

  return {
    workspaceToken,
    engine: "sqlite",
    analytics,
    stamp: async () => workspaceStamp(await bridge.stamp(workspaceToken)),
    readSubset: async (spec, options) => {
      const result = await cancellable(
        (requestId) => bridge.readSubset({ workspaceToken, requestId, spec }),
        options,
      );
      return {
        stamp: workspaceStamp(result.stamp),
        rows: result.rows.map((row) => decodeSqliteResultRow(row)),
      };
    },
    readBatch: async (specs, options) => {
      const result = await cancellable(
        (requestId) => bridge.readBatch({ workspaceToken, requestId, specs }),
        options,
      );
      return {
        stamp: workspaceStamp(result.stamp),
        reads: result.reads.map((rows) => rows.map((row) => decodeSqliteResultRow(row))),
      };
    },
    summarizeSubset: async (spec) => {
      const result = await bridge.summarizeSubset({ workspaceToken, spec });
      return { stamp: workspaceStamp(result.stamp), summary: decodeSummary(result.summary) };
    },
    readInsights: async (window) => {
      const result = await bridge.readInsights({ workspaceToken, window });
      return { stamp: workspaceStamp(result.stamp), facts: decodeInsightsFacts(result.facts) };
    },
    readOutboxStatuses: async () =>
      decodedSome(await bridge.readOutboxStatuses(workspaceToken), decodeCommandStatus),
    enqueueCommand: async (request) => {
      const queued = await bridge.enqueueCommand({
        workspaceToken,
        request: encodeEnqueueRequest(request),
      });
      return {
        operationId: queued.operationId,
        status: decodeQueuedCommandStatus(queued.status),
        stamp: workspaceStamp(queued.stamp),
      };
    },
    readCommandStatus: async (operationId) => {
      const status = await bridge.readCommandStatus({ workspaceToken, operationId });
      return status === null ? undefined : decodeQueuedCommandStatus(status);
    },
    subscribe: publisher.subscribe,
    subscribeSyncHealth: (listener) => {
      const unsubscribe = bridge.onSyncHealth(workspaceToken, listener);
      lifetime.onClose(Effect.sync(unsubscribe));
      return unsubscribe;
    },
    retryRecovery: () => bridge.retryRecovery(workspaceToken),
    wakeSyncUpload: () => {
      void bridge.wakeSyncUpload(workspaceToken).catch(() => undefined);
    },
    close: lifetime.close,
  };
};
