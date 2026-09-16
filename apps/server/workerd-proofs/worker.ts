import { DurableObject } from "cloudflare:workers";
import { LAST_UNIT_BATCH_ID, lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import { batches, categories, invoices } from "@store/db/inventory.schema";
import { inventoryMigrations } from "@store/db/inventory/migrations";
import { commitPreparedCommand } from "@store/sync/authority";
import { lastUnitActor, seedLastUnitCatalog } from "@store/sync/authority/seed";
import { runMigrations, type SqliteMigrationTarget } from "@store/sync/migrations";
import { runSqliteTransaction, type SqliteDatabase } from "@store/sync/sqlite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

export type Env = {
  PROOF: DurableObjectNamespace<SyncWorkerdProof>;
  SNAPSHOTS: R2Bucket;
};

export type RpcEcho = {
  readonly _tag: string;
  readonly message: string;
};

export type LiveAttachment = {
  readonly replicaId: string;
};

const MigrationKeyRow = Schema.Struct({
  key: Schema.String,
});

const LiveAttachmentRow = Schema.Struct({
  replicaId: Schema.String,
});

const ALARM_FIRED_KEY = "alarmFired";
const LIVE_ATTACHMENT: LiveAttachment = { replicaId: "replica-live" };

const durableSqliteMigrationTarget = (storage: DurableObjectStorage): SqliteMigrationTarget => ({
  execute: (sql, parameters) => {
    storage.sql.exec(sql, ...parameters);
  },
  appliedKeys: (sql) => {
    const keys: Array<string> = [];
    for (const row of storage.sql.exec(sql)) {
      keys.push(Schema.decodeUnknownSync(MigrationKeyRow)(row).key);
    }
    return keys;
  },
});

const openDb = (storage: DurableObjectStorage): SqliteDatabase => {
  runMigrations(inventoryMigrations, durableSqliteMigrationTarget(storage));
  return drizzle(storage);
};

const unitQuantity = (db: SqliteDatabase): number => {
  const row = db.select().from(batches).where(eq(batches.id, LAST_UNIT_BATCH_ID)).get();
  return row?.unitQuantity ?? -1;
};

const invoiceCount = (db: SqliteDatabase): number => db.select().from(invoices).all().length;

const ghostCategory = {
  id: "ghost",
  name: "Ghost",
  tracksPacks: false,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  organizationId: lastUnitActor.organizationId,
  createdByUserId: lastUnitActor.userId,
  updatedByUserId: lastUnitActor.userId,
  deviceId: "replica-a",
  operationId: "ghost-category",
  rowVersion: 1,
} as const;

export class SyncWorkerdProof extends DurableObject<Env> {
  #db(): SqliteDatabase {
    return openDb(this.ctx.storage);
  }

  async lastUnitSale(): Promise<{
    readonly decision: string;
    readonly unitQuantity: number;
    readonly invoiceCount: number;
  }> {
    const db = this.#db();
    seedLastUnitCatalog(db);
    const receipt = runSqliteTransaction(db, (tx) =>
      commitPreparedCommand(tx, {
        actor: lastUnitActor,
        envelope: lastUnitBuyerAEnvelope,
        receivedAt: 1_700_000_000_000,
      }),
    );
    return {
      decision: receipt.decision,
      unitQuantity: unitQuantity(db),
      invoiceCount: invoiceCount(db),
    };
  }

  async drizzleThrowRollsBack(): Promise<{
    readonly categoryCount: number;
    readonly threw: boolean;
  }> {
    const db = this.#db();
    seedLastUnitCatalog(db);
    let threw = false;
    try {
      runSqliteTransaction(db, (tx) => {
        tx.insert(categories).values(ghostCategory).run();
        throw new Error("forced failure after domain write");
      });
    } catch {
      threw = true;
    }
    const categoryCount = db.select().from(categories).all().length;
    return { categoryCount, threw };
  }

  async storageTransactionRollsBack(): Promise<{
    readonly categoryCount: number;
    readonly threw: boolean;
  }> {
    const db = this.#db();
    seedLastUnitCatalog(db);
    let threw = false;
    try {
      this.ctx.storage.transactionSync(() => {
        db.insert(categories)
          .values({ ...ghostCategory, id: "ghost-sync" })
          .run();
        throw new Error("forced failure inside transactionSync");
      });
    } catch {
      threw = true;
    }
    const categoryCount = db.select().from(categories).all().length;
    return { categoryCount, threw };
  }

  async commandTriggerRollsBack(): Promise<{
    readonly unitQuantity: number;
    readonly invoiceCount: number;
    readonly threw: boolean;
  }> {
    const db = this.#db();
    seedLastUnitCatalog(db);
    this.ctx.storage.sql.exec(`
      CREATE TRIGGER fail_after_invoice AFTER INSERT ON invoices
      BEGIN
        SELECT RAISE(ROLLBACK, 'forced rollback');
      END;
    `);
    let threw = false;
    try {
      runSqliteTransaction(db, (tx) =>
        commitPreparedCommand(tx, {
          actor: lastUnitActor,
          envelope: lastUnitBuyerAEnvelope,
          receivedAt: 1_700_000_000_000,
        }),
      );
    } catch {
      threw = true;
    }
    return {
      unitQuantity: unitQuantity(db),
      invoiceCount: invoiceCount(db),
      threw,
    };
  }

  async armAlarm(): Promise<boolean> {
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    return (await this.ctx.storage.getAlarm()) !== null;
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.put(ALARM_FIRED_KEY, true);
  }

  async alarmFired(): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>(ALARM_FIRED_KEY)) === true;
  }

  async echoRpc(value: RpcEcho): Promise<RpcEcho> {
    return value;
  }

  async putSnapshot(key: string, bytes: ArrayBuffer): Promise<void> {
    await this.env.SNAPSHOTS.put(key, bytes);
  }

  async getSnapshot(key: string): Promise<ArrayBuffer | null> {
    const object = await this.env.SNAPSHOTS.get(key);
    if (!object) return null;
    return object.arrayBuffer();
  }

  override async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment(LIVE_ATTACHMENT);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    socket.send(message);
  }

  liveAttachment(): LiveAttachment | null {
    const sockets = this.ctx.getWebSockets();
    const decoded = Schema.decodeUnknownResult(LiveAttachmentRow)(
      sockets[0]?.deserializeAttachment(),
    );
    if (Result.isFailure(decoded)) return null;
    return decoded.success;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.PROOF.idFromName(new URL(request.url).pathname);
    return env.PROOF.get(id).fetch(request);
  },
};
