import type { SyncRequest, SyncResponse } from "@store/contracts";
import { DurableObject } from "cloudflare:workers";

import type { SyncActor } from "./model";
import { makeSyncRuntime } from "./runtime";

/**
 * One Durable Object per organization, holding that organization's synced store
 * in its own SQLite database.
 *
 * The sharding key is `organizationId`, which every query in the sync path
 * already filters by. Because a Durable Object handles one request at a time and
 * owns its storage exclusively, this also removes the need for the advisory lock
 * the Postgres implementation used to serialize a device's operation sequence.
 */
export class OrganizationStore extends DurableObject<Env> {
  /**
   * Called over RPC from the Worker. The Worker has already authenticated the
   * caller and resolved the organization, so `actor` is trusted here; the
   * request body is still validated by `SyncService` before it touches storage.
   */
  async exchange(actor: SyncActor, request: SyncRequest): Promise<SyncResponse> {
    const runtime = makeSyncRuntime(this.ctx.storage);
    try {
      return await runtime.runSync(actor, request);
    } finally {
      await runtime.dispose();
    }
  }
}
