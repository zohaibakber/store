import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { WebCrypto } from "@store/auth";
import { makeReplicaDb, type ReplicaDb } from "@store/sync/authority";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import {
  MaintenanceAlarm,
  OrgAuthorityFacade,
  type OrgAuthorityApi,
} from "../../src/authority/facade";
import { OrgAuthorities, OrganizationAuthority } from "../../src/inventory/organization-authority";
import { TEST_EPOCH, testRuntimeContext } from "../lib/app";

export type TestAuthority = {
  readonly api: OrgAuthorityApi;
  readonly db: ReplicaDb;
  readonly sql: SqlClient.SqlClient;
  readonly alarms: Array<number>;
};

export const SequentialCrypto = Layer.effect(
  Crypto.Crypto,
  Effect.gen(function* () {
    const real = yield* Crypto.Crypto;
    let minted = 0;
    return Crypto.make({
      digest: (algorithm, data) => real.digest(algorithm, data),
      randomBytes: (size) => {
        minted += 1;
        const bytes = new Uint8Array(size);
        new DataView(bytes.buffer).setUint32(0, minted);
        return bytes;
      },
    });
  }),
).pipe(Layer.provide(WebCrypto.layer));

export class TestAuthorities extends Context.Service<
  TestAuthorities,
  OrgAuthorities["Service"] & {
    readonly open: (organizationId: string) => Effect.Effect<TestAuthority>;
    readonly of: (organizationId: string) => TestAuthority;
  }
>()("@store/server/TestAuthorities") {
  static readonly layer = Layer.effect(
    TestAuthorities,
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const crypto = yield* Crypto.Crypto;
      const authorities = new Map<string, TestAuthority>();
      const of = (organizationId: string) => {
        const found = authorities.get(organizationId);
        if (found === undefined) throw new Error(`No test authority for ${organizationId}.`);
        return found;
      };
      const open = (organizationId: string) =>
        Effect.gen(function* () {
          const existing = authorities.get(organizationId);
          if (existing !== undefined) return existing;
          const sql = yield* SqliteClient.make({ filename: ":memory:" }).pipe(
            Effect.provide(Reactivity.layer),
            Effect.orDie,
          );
          const db = yield* makeReplicaDb(sql);
          const alarms: Array<number> = [];
          const recordAlarm = (at: number) => Effect.sync(() => void alarms.push(at));
          const context = yield* Layer.build(
            OrgAuthorityFacade.layer.pipe(
              Layer.provide([
                Layer.succeed(SqlClient.SqlClient, sql),
                Layer.succeed(MaintenanceAlarm, {
                  scheduleAt: recordAlarm,
                  scheduleBy: recordAlarm,
                }),
                Layer.succeed(Crypto.Crypto, crypto),
              ]),
            ),
          );
          const api = Context.get(context, OrgAuthorityFacade);
          const authority = { api, db, sql, alarms } satisfies TestAuthority;
          authorities.set(organizationId, authority);
          return authority;
        }).pipe(Scope.provide(scope));
      return TestAuthorities.of({
        open,
        of,
        getByName: (organizationId) => of(organizationId).api,
      });
    }),
  ).pipe(Layer.provide(SequentialCrypto));
}

const organizationAuthorities = Layer.effect(OrgAuthorities, TestAuthorities);

export const authorityTest = OrganizationAuthority.layer.pipe(
  Layer.provide(organizationAuthorities),
  Layer.provideMerge(TestAuthorities.layer),
  Layer.provideMerge(Layer.succeedContext(testRuntimeContext)),
);

export const scenario = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  TestClock.setTime(TEST_EPOCH).pipe(Effect.andThen(self), Effect.provide(authorityTest));
