import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import { WebCrypto } from "@store/auth";
import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";

import { OrgAuthority, type OrgAuthorityContract } from "../../api";
import { MaintenanceAlarm, OrgAuthorityFacade } from "./facade";

export const OrgAuthorityLive = OrgAuthority.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const crypto = yield* Crypto.Crypto;
    return Effect.gen(function* () {
      const sql = yield* SqliteClient.make({ storage: state.raw.storage }).pipe(
        Effect.provide(Reactivity.layer),
      );
      const armedAt = yield* Ref.make<number | null | undefined>(undefined);
      const alarmAt = (at: number) =>
        Effect.andThen(state.storage.setAlarm(at), Ref.set(armedAt, at)).pipe(
          Effect.provide(RuntimeContext.phantom),
        );
      const scheduledAlarm = Effect.flatMap(Ref.get(armedAt), (known) =>
        known === undefined
          ? Effect.tap(state.storage.getAlarm(), (scheduled) => Ref.set(armedAt, scheduled)).pipe(
              Effect.provide(RuntimeContext.phantom),
            )
          : Effect.succeed(known),
      );
      const alarm = MaintenanceAlarm.of({
        scheduleAt: alarmAt,
        scheduleBy: (at) =>
          Effect.flatMap(scheduledAlarm, (scheduled) =>
            scheduled === null || scheduled > at ? alarmAt(at) : Effect.void,
          ),
      });
      const context = yield* Layer.build(
        OrgAuthorityFacade.layer.pipe(
          Layer.provide([
            Layer.succeed(SqlClient.SqlClient, sql),
            Layer.succeed(Crypto.Crypto, crypto),
            Layer.succeed(MaintenanceAlarm, alarm),
          ]),
        ),
      );
      const authority = Context.get(context, OrgAuthorityFacade);
      return {
        ...authority,
        alarm: () => Effect.andThen(Ref.set(armedAt, null), Effect.asVoid(authority.maintain())),
      } satisfies OrgAuthorityContract;
    });
  }).pipe(Effect.provide(WebCrypto.layer)),
);
