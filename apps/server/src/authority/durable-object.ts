import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import { WebCrypto } from "@store/auth";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Ref from "effect/Ref";

import { OrgAuthority, type OrgAuthorityContract } from "../../api";
import { makeOrgAuthority } from "./facade";

const mintId = Effect.flatMap(Crypto.Crypto, (crypto) => crypto.randomUUIDv4()).pipe(
  Effect.map((uuid) => uuid.replaceAll("-", "")),
  Effect.orDie,
);

export const OrgAuthorityLive = OrgAuthority.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const crypto = yield* Crypto.Crypto;
    return Effect.gen(function* () {
      const storage = state.raw.storage;
      const sql = yield* SqliteClient.make({ storage }).pipe(Effect.provide(Reactivity.layer));
      const armedAt = yield* Ref.make<number | null | undefined>(undefined);
      const alarmAt = (at: number) =>
        Effect.andThen(
          Effect.promise(() => storage.setAlarm(at)),
          Ref.set(armedAt, at),
        );
      const scheduledAlarm = Effect.flatMap(Ref.get(armedAt), (known) =>
        known === undefined
          ? Effect.tap(
              Effect.promise(() => storage.getAlarm()),
              (scheduled) => Ref.set(armedAt, scheduled),
            )
          : Effect.succeed(known),
      );
      const authority = yield* makeOrgAuthority({
        sql,
        mintId: Effect.provideService(mintId, Crypto.Crypto, crypto),
        alarm: {
          scheduleAt: alarmAt,
          scheduleBy: (at) =>
            Effect.flatMap(scheduledAlarm, (scheduled) =>
              scheduled === null || scheduled > at ? alarmAt(at) : Effect.void,
            ),
        },
      });
      return {
        ...authority,
        alarm: () => Effect.andThen(Ref.set(armedAt, null), Effect.asVoid(authority.maintain())),
      } satisfies OrgAuthorityContract;
    });
  }).pipe(Effect.provide(WebCrypto.layer)),
);
