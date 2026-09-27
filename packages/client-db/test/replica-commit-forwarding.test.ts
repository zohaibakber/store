import { ReplicaStore } from "@store/sync/browser";
import { layerSqliteReplicaStore } from "@store/sync/sqlite";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { describe, expect, it, vi } from "vitest";

import { layerCommitForwarding } from "../src/replica/commit-forwarding";
import { layerSeededSqliteReplica } from "../src/replica/node-sqlite";
import { createReplicaCommitPublisher } from "../src/replica/publisher";
import type { ReplicaCommitNotice } from "../src/replica/types";

const identity = { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" };

describe("layerCommitForwarding", () => {
  it("forwards a store commit made as soon as the workspace runtime is built", async () => {
    const publisher = createReplicaCommitPublisher();
    const runtime = ManagedRuntime.make(
      layerCommitForwarding("workspace-1", publisher).pipe(
        Layer.provideMerge(layerSqliteReplicaStore("workspace-1")),
        Layer.provideMerge(layerSeededSqliteReplica(":memory:", identity)),
      ),
    );
    const store = await runtime.runPromise(ReplicaStore.use(Effect.succeed));
    const notices: Array<ReplicaCommitNotice> = [];
    const unsubscribe = publisher.subscribe((notice) => notices.push(notice));

    await runtime.runPromise(store.recordCaughtUp(1));

    await vi.waitFor(() =>
      expect(notices.map((notice) => notice.workspaceToken)).toEqual(["workspace-1"]),
    );
    unsubscribe();
    publisher.dispose();
    await runtime.dispose();
  });
});
