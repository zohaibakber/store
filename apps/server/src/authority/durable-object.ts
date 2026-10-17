import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import { WebCrypto } from "@store/auth";
import { makeReplicaDb } from "@store/sync/authority";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Ref from "effect/Ref";

import { OrgAuthority, type OrgAuthorityContract } from "../../api";
import { openInventoryDrizzle } from "../inventory/postgres";
import { postgresAdoption } from "./adopt";
import { makeOrgAuthority } from "./facade";

const mintId = Effect.flatMap(Crypto.Crypto, (crypto) => crypto.randomUUIDv4()).pipe(
  Effect.map((uuid) => uuid.replaceAll("-", "")),
  Effect.orDie,
);

export const OrgAuthorityLive = OrgAuthority.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const source = postgresAdoption(
      yield* openInventoryDrizzle.pipe(Effect.provide(Cloudflare.Hyperdrive.ConnectBinding)),
    );
    const crypto = yield* Crypto.Crypto;
    return Effect.gen(function* () {
      const storage = state.raw.storage;
      const sql = yield* SqliteClient.make({ storage }).pipe(Effect.provide(Reactivity.layer));
      const db = yield* makeReplicaDb(sql);
      const settled = yield* Ref.make(false);
      const alarmAt = (at: number) => Effect.promise(() => storage.setAlarm(at));
      const authority = yield* makeOrgAuthority({
        sql,
        mintId: Effect.provideService(mintId, Crypto.Crypto, crypto),
        alarm: {
          scheduleAt: alarmAt,
          scheduleBy: (at) =>
            Effect.flatMap(
              Effect.promise(() => storage.getAlarm()),
              (scheduled) => (scheduled === null || scheduled > at ? alarmAt(at) : Effect.void),
            ),
        },
        adopt: (actor) =>
          Effect.gen(function* () {
            if (yield* Ref.get(settled)) return;
            yield* state.blockConcurrencyWhile(() =>
              Effect.gen(function* () {
                if (yield* Ref.get(settled)) return;
                const held = yield* sql`select 1 as held from authority_state limit 1`;
                if (held.length === 0) yield* source.adopt(actor, sql, db);
                yield* Ref.set(settled, true);
              }).pipe(
                Effect.tapCause((cause) =>
                  Effect.logError("authority.adoption_failed").pipe(
                    Effect.annotateLogs({ organizationId: actor.organizationId, cause }),
                  ),
                ),
                Effect.orDie,
              ),
            );
          }),
      });
      return {
        ...authority,
        alarm: () => Effect.asVoid(authority.maintain()),
      } satisfies OrgAuthorityContract;
    });
  }).pipe(Effect.provide(WebCrypto.layer)),
);
