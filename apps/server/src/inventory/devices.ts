import {
  MAX_ORGANIZATION_DEVICES,
  SYNC_SCHEMA_VERSION,
  type DeviceCommand,
  type OrganizationDevices,
} from "@store/contracts";
import { replicas } from "@store/db/postgres/schema";
import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import type { InventoryError } from "./errors";
import type { InventoryActor } from "./model";
import { runStatement, type InventoryDrizzle } from "./postgres";

export interface InventoryDevicesContract {
  readonly list: (actor: InventoryActor) => Effect.Effect<OrganizationDevices, InventoryError>;
  readonly command: (
    actor: InventoryActor,
    command: DeviceCommand,
  ) => Effect.Effect<OrganizationDevices, InventoryError>;
}

export class InventoryDevices extends Context.Service<InventoryDevices, InventoryDevicesContract>()(
  "@store/server/InventoryDevices",
) {}

const standingOf = (command: DeviceCommand, now: number) => {
  switch (command._tag) {
    case "IgnoreDevice":
      return { ignoredAt: now };
    case "HeedDevice":
      return { ignoredAt: null };
    case "RemoveDevice":
      return { removedAt: now };
  }
};

export const makeInventoryDevices = (db: InventoryDrizzle): InventoryDevicesContract => {
  const list = Effect.fn("InventoryDevices.list")(function* (actor: InventoryActor) {
    const now = yield* Clock.currentTimeMillis;
    const rows = yield* runStatement(
      db
        .select({
          replicaId: replicas.replicaId,
          userId: replicas.ownerUserId,
          label: replicas.deviceLabel,
          registeredAt: replicas.registeredAt,
          lastSeenAt: replicas.lastSeenAt,
          schemaVersion: replicas.schemaVersion,
          schemaVersionAt: replicas.schemaVersionAt,
          ignoredAt: replicas.ignoredAt,
          active: sql<boolean>`exists (
            select 1 from sync.active_replicas(${actor.organizationId}::text, ${now}::bigint) as "a"
            where "a"."replica_id" = "replicas"."replica_id"
          )`,
        })
        .from(replicas)
        .where(
          and(
            eq(replicas.organizationId, actor.organizationId),
            or(isNull(replicas.removedAt), gt(replicas.lastSeenAt, replicas.removedAt)),
          ),
        )
        .orderBy(desc(replicas.lastSeenAt), asc(replicas.replicaId))
        .limit(MAX_ORGANIZATION_DEVICES),
    );
    return {
      devices: rows.map((row) => {
        const upToDate = row.schemaVersion >= SYNC_SCHEMA_VERSION;
        return {
          replicaId: row.replicaId,
          userId: row.userId,
          label: row.label || null,
          registeredAt: row.registeredAt,
          lastSeenAt: row.lastSeenAt,
          upToDate,
          ignored: row.ignoredAt !== null && row.ignoredAt >= (row.schemaVersionAt ?? 0),
          holdsBack: row.active && !upToDate,
        };
      }),
    } satisfies OrganizationDevices;
  });

  return InventoryDevices.of({
    list,
    command: Effect.fn("InventoryDevices.command")(function* (actor, command) {
      const now = yield* Clock.currentTimeMillis;
      yield* runStatement(
        db
          .update(replicas)
          .set(standingOf(command, now))
          .where(
            and(
              eq(replicas.organizationId, actor.organizationId),
              eq(replicas.replicaId, command.replicaId),
            ),
          ),
      );
      return yield* list(actor);
    }),
  });
};
