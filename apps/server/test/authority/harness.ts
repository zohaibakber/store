import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { WebCrypto } from "@store/auth";
import { makeReplicaDb, type ReplicaDb } from "@store/sync/authority";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Reactivity from "effect/reactivity/Reactivity";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";

import {
  MaintenanceAlarm,
  OrgAuthorityFacade,
  type OrgAuthorityApi,
} from "../../src/authority/facade";
import { OrgAuthorities, OrganizationAuthority } from "../../src/inventory/organization-authority";

export type TestAuthority = {
  readonly api: OrgAuthorityApi;
  readonly db: ReplicaDb;
  readonly sql: SqlClient.SqlClient;
  readonly alarms: Array<number>;
};

let minted = 0;

const SequentialCrypto = Layer.effect(
  Crypto.Crypto,
  Effect.map(Crypto.Crypto, (real) =>
    Crypto.make({
      digest: (algorithm, data) => real.digest(algorithm, data),
      randomBytes: (size) => {
        minted += 1;
        const bytes = new Uint8Array(size);
        new DataView(bytes.buffer).setUint32(0, minted);
        return bytes;
      },
    }),
  ),
).pipe(Layer.provide(WebCrypto.layer));

export type TestAuthorities = OrgAuthorities["Service"] & {
  readonly open: (organizationId: string) => Effect.Effect<TestAuthority, never, Scope.Scope>;
  readonly of: (organizationId: string) => TestAuthority;
};

export const makeTestAuthorities = (): TestAuthorities => {
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
            SequentialCrypto,
          ]),
        ),
      );
      const api = Context.get(context, OrgAuthorityFacade);
      const authority = { api, db, sql, alarms } satisfies TestAuthority;
      authorities.set(organizationId, authority);
      return authority;
    });
  return { open, of, getByName: (organizationId) => of(organizationId).api };
};

export const organizationAuthorityFor = (authorities: TestAuthorities) =>
  OrganizationAuthority.pipe(
    Effect.provide(
      OrganizationAuthority.layer.pipe(Layer.provide(Layer.succeed(OrgAuthorities, authorities))),
    ),
  );
