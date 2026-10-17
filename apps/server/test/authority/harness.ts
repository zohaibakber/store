import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { makeReplicaDb, type ReplicaDb } from "@store/sync/authority";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import type * as Scope from "effect/Scope";
import type { SqlClient } from "effect/sql/SqlClient";

import { NO_ADOPTION, settleAdoption, type AdoptionSource } from "../../src/authority/adopt";
import type { AuthorityActor } from "../../src/authority/engine";
import { makeOrgAuthority, type OrgAuthorityApi } from "../../src/authority/facade";
import type { AuthorityNamespace } from "../../src/inventory/authority-client";

export type TestAuthority = {
  readonly api: OrgAuthorityApi;
  readonly db: ReplicaDb;
  readonly sql: SqlClient;
  readonly alarms: Array<number>;
};

let minted = 0;

const mintId = Effect.sync(() => {
  minted += 1;
  return `${Date.now().toString(16)}${minted.toString(16).padStart(8, "0")}`.padEnd(32, "0");
});

export type TestAuthorities = AuthorityNamespace & {
  readonly open: (organizationId: string) => Effect.Effect<TestAuthority, never, Scope.Scope>;
  readonly of: (organizationId: string) => TestAuthority;
};

export const makeTestAuthorities = (
  options: { readonly adoption?: AdoptionSource } = {},
): TestAuthorities => {
  const authorities = new Map<string, TestAuthority>();
  const adoption = options.adoption ?? NO_ADOPTION;
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
      let adopted = false;
      const api = yield* makeOrgAuthority({
        sql,
        mintId,
        alarm: {
          scheduleAt: (at) => Effect.sync(() => void alarms.push(at)),
          scheduleBy: (at) => Effect.sync(() => void alarms.push(at)),
        },
        adopt: (actor: AuthorityActor, db: ReplicaDb) =>
          adopted
            ? Effect.succeed(false)
            : settleAdoption(adoption, actor, sql, db).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    adopted = true;
                  }),
                ),
                Effect.orDie,
              ),
      });
      const authority = { api, db, sql, alarms } satisfies TestAuthority;
      authorities.set(organizationId, authority);
      return authority;
    });
  return { open, of, getByName: (organizationId) => of(organizationId).api };
};
