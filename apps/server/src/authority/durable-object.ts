import * as Cloudflare from "@alchemy.run/cloudflare";
import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";

import { OrgAuthority, type OrgAuthorityContract } from "../../api";
import { LiveBroadcast, MaintenanceAlarm, OrgAuthorityFacade } from "./facade";
import { makeLiveSockets } from "./live-sockets";

export const OrgAuthorityLive = OrgAuthority.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const crypto = yield* SecureRandom.SecureRandom;
    const digest = yield* Digest.Digest;
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
      const sockets = yield* makeLiveSockets(state, alarm.scheduleBy);
      const live = LiveBroadcast.of({
        publish: (fanout) =>
          Effect.asVoid(sockets.publish(fanout)).pipe(Effect.provide(RuntimeContext.phantom)),
      });
      const context = yield* Layer.build(
        OrgAuthorityFacade.layer.pipe(
          Layer.provide([
            Layer.succeed(SqlClient.SqlClient, sql),
            Layer.succeed(SecureRandom.SecureRandom, crypto),
            Layer.succeed(Digest.Digest, digest),
            Layer.succeed(MaintenanceAlarm, alarm),
            Layer.succeed(LiveBroadcast, live),
          ]),
        ),
      );
      const authority = Context.get(context, OrgAuthorityFacade);
      return {
        ...authority,
        fetch: sockets.admit(authority.liveHorizon),
        webSocketMessage: sockets.webSocketMessage,
        webSocketClose: sockets.webSocketClose,
        alarm: () =>
          Ref.set(armedAt, null).pipe(
            Effect.andThen(authority.maintain()),
            Effect.andThen(sockets.sweep()),
          ),
      } satisfies OrgAuthorityContract;
    });
  }).pipe(Effect.provide([SecureRandom.layerWebCrypto, Digest.layerWebCrypto])),
);
