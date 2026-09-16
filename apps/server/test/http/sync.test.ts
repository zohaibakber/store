import {
  InventoryImportId,
  InventoryObjectName,
  InventoryReleaseId,
  OrgCommitSequence,
  OrganizationId,
  SyncCommandEnvelope,
  syncProtocolError,
} from "@store/contracts";
import { lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { InventoryNotPublished } from "../../src/inventory/inventory-directory";
import type { OrganizationInventoryNamespace } from "../../src/inventory/organization-host";
import {
  makeRoutedSyncAuthority,
  type SyncAuthorityContract,
} from "../../src/inventory/sync-authority";
import { appFor } from "../lib/app";

const commandPost = (body: SyncCommandEnvelope = lastUnitBuyerAEnvelope) =>
  ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) satisfies RequestInit;

describe("sync HTTP", () => {
  it("requires an authenticated organization", async () => {
    const response = await appFor(false).request("/api/sync/commands", commandPost());
    expect(response.status).toBe(401);
  });

  it("returns 503 until the organization store is provisioned", async () => {
    const response = await appFor(true).request("/api/sync/commands", commandPost());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "SYNC_NOT_PROVISIONED" },
    });
  });

  it("maps organization mismatch to 403", async () => {
    const syncAuthority: SyncAuthorityContract = {
      registerReplica: () => Effect.die("unused"),
      getReceipt: () => Effect.die("unused"),
      pull: () => Effect.die("unused"),
      acquireSnapshot: () => Effect.die("unused"),
      readSnapshotPart: () => Effect.die("unused"),
      mintLiveTicket: () => Effect.die("unused"),
      submitCommand: () =>
        Effect.fail(
          syncProtocolError(
            "ORGANIZATION_MISMATCH",
            "The command does not belong to the active organization.",
          ),
        ),
    };
    const response = await appFor(true, { syncAuthority }).request(
      "/api/sync/commands",
      commandPost(),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "ORGANIZATION_MISMATCH" },
    });
  });

  it("returns a receipt from the test authority", async () => {
    const receipt = {
      operationId: lastUnitBuyerAEnvelope.operationId,
      replicaId: lastUnitBuyerAEnvelope.replicaId,
      clientSequence: lastUnitBuyerAEnvelope.clientSequence,
      payloadHash: lastUnitBuyerAEnvelope.payloadHash,
      decision: "accepted" as const,
      commitSequence: OrgCommitSequence.make("1"),
      result: {
        _tag: "issueInvoice" as const,
        invoiceId: lastUnitBuyerAEnvelope.command.payload.invoiceId,
        invoiceNumber: 1,
      },
    };
    const syncAuthority: SyncAuthorityContract = {
      registerReplica: () => Effect.die("unused"),
      getReceipt: () => Effect.succeed(receipt),
      pull: () => Effect.die("unused"),
      acquireSnapshot: () => Effect.die("unused"),
      readSnapshotPart: () => Effect.die("unused"),
      mintLiveTicket: () => Effect.die("unused"),
      submitCommand: () => Effect.succeed(receipt),
    };
    const response = await appFor(true, { syncAuthority }).request(
      "/api/sync/commands",
      commandPost(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      operationId: lastUnitBuyerAEnvelope.operationId,
      decision: "accepted",
    });
  });

  it("refuses an organization with no active release instead of 500", async () => {
    const syncAuthority = makeRoutedSyncAuthority(
      {
        resolveActive: () =>
          Effect.fail(
            InventoryNotPublished.make({
              message: "This organization has no published inventory.",
            }),
          ),
      },
      {
        getByName: () => {
          throw new Error("directory miss must not select an object");
        },
      },
      {
        getObject: () => Effect.die("unused"),
        putObject: () => Effect.die("unused"),
      },
    );
    const response = await appFor(true, { syncAuthority }).request(
      "/api/sync/commands",
      commandPost(),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "EPOCH_MISMATCH" },
    });
  });

  it("maps a refusal decoded from the RPC success channel to 403", async () => {
    const syncAuthority = makeRoutedSyncAuthority(
      {
        resolveActive: () =>
          Effect.succeed({
            objectName: Schema.decodeUnknownSync(InventoryObjectName)("inventory-org-1"),
            evidence: {
              organizationId: Schema.decodeUnknownSync(OrganizationId)("org-1"),
              importId: Schema.decodeUnknownSync(InventoryImportId)("import-test"),
              releaseId: Schema.decodeUnknownSync(InventoryReleaseId)("release-test"),
            },
          }),
      },
      {
        getByName: () => ({
          registerReplica: () => Effect.die("unused"),
          submitCommand: () =>
            Effect.succeed({
              _tag: "protocolFailure",
              code: "ORGANIZATION_MISMATCH",
              message: "The command does not belong to the active organization.",
            }),
          getReceipt: () => Effect.die("unused"),
          pull: () => Effect.die("unused"),
          acquireSnapshot: () => Effect.die("unused"),
          mintLiveTicket: () => Effect.die("unused"),
          locateSnapshotPart: () => Effect.die("unused"),
          fetch: () => Effect.die("unused"),
        }),
      },
      {
        getObject: () => Effect.die("unused"),
        putObject: () => Effect.die("unused"),
      },
    );
    const response = await appFor(true, { syncAuthority }).request(
      "/api/sync/commands",
      commandPost(),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "ORGANIZATION_MISMATCH" },
    });
  });

  it("ignores routing evidence supplied in a request header or body", async () => {
    const evidence = {
      organizationId: Schema.decodeUnknownSync(OrganizationId)("org-1"),
      importId: Schema.decodeUnknownSync(InventoryImportId)("import-test"),
      releaseId: Schema.decodeUnknownSync(InventoryReleaseId)("release-test"),
    };
    const received: Array<unknown> = [];
    const objects: OrganizationInventoryNamespace = {
      getByName: (name) => {
        received.push(name);
        return {
          registerReplica: () => Effect.die("unused"),
          submitCommand: (call) => {
            received.push(call.route);
            return Effect.succeed({
              _tag: "success",
              value: {
                operationId: lastUnitBuyerAEnvelope.operationId,
                replicaId: lastUnitBuyerAEnvelope.replicaId,
                clientSequence: lastUnitBuyerAEnvelope.clientSequence,
                payloadHash: lastUnitBuyerAEnvelope.payloadHash,
                decision: "accepted",
                commitSequence: OrgCommitSequence.make("1"),
                result: {
                  _tag: "issueInvoice",
                  invoiceId: lastUnitBuyerAEnvelope.command.payload.invoiceId,
                  invoiceNumber: 1,
                },
              },
            });
          },
          getReceipt: () => Effect.die("unused"),
          pull: () => Effect.die("unused"),
          acquireSnapshot: () => Effect.die("unused"),
          mintLiveTicket: () => Effect.die("unused"),
          locateSnapshotPart: () => Effect.die("unused"),
          fetch: () => Effect.die("unused"),
        };
      },
    };
    const syncAuthority = makeRoutedSyncAuthority(
      {
        resolveActive: () =>
          Effect.succeed({
            objectName: Schema.decodeUnknownSync(InventoryObjectName)("inventory-org-1"),
            evidence,
          }),
      },
      objects,
      {
        getObject: () => Effect.die("unused"),
        putObject: () => Effect.die("unused"),
      },
    );
    const response = await appFor(true, { syncAuthority }).request("/api/sync/commands", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-inventory-object": "inventory-attacker",
        "x-inventory-import": "import-attacker",
        "x-inventory-release": "release-attacker",
      },
      body: JSON.stringify({
        ...lastUnitBuyerAEnvelope,
        importId: "import-attacker",
        releaseId: "release-attacker",
        objectName: "inventory-attacker",
      }),
    });
    expect(response.status).toBe(200);
    expect(received).toEqual(["inventory-org-1", evidence]);
  });

  it("maps SNAPSHOT_REQUIRED to 409", async () => {
    const syncAuthority: SyncAuthorityContract = {
      registerReplica: () => Effect.die("unused"),
      getReceipt: () => Effect.die("unused"),
      pull: () =>
        Effect.fail(
          syncProtocolError(
            "SNAPSHOT_REQUIRED",
            "This replica is behind the retained history and needs a snapshot.",
          ),
        ),
      acquireSnapshot: () => Effect.die("unused"),
      readSnapshotPart: () => Effect.die("unused"),
      mintLiveTicket: () => Effect.die("unused"),
      submitCommand: () => Effect.die("unused"),
    };
    const response = await appFor(true, { syncAuthority }).request("/api/sync/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        epoch: "1",
        subscription: "operational",
        afterCommitSequence: "0",
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "SNAPSHOT_REQUIRED" },
    });
  });

  it("refuses an unauthenticated live upgrade", async () => {
    const response = await appFor(false).request("/api/sync/live?nonce=ab");
    expect(response.status).toBe(401);
  });
});
