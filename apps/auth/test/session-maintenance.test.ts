import { EmailAddress, PasswordHash, SessionId, type OrganizationId } from "@store/auth";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { AuthRepository, authRepositoryLayer, type AuthRepositoryApi } from "../src/repository";
import { pruneExpiredSessions } from "../src/session-maintenance";
import { authD1 } from "./sqlite-d1";

const repositoryOn = (d1: ReturnType<typeof authD1>) => {
  const layer = authRepositoryLayer(d1);
  return <A, E>(use: (repository: AuthRepositoryApi) => Effect.Effect<A, E>) =>
    Effect.runPromise(AuthRepository.use(use).pipe(Effect.provide(layer)));
};

const PASSWORD_HASH = PasswordHash.make("pbkdf2-sha256$100000$c2FsdA$aGFzaA");

const seedOwner = (repository: AuthRepositoryApi, email: string) =>
  Effect.gen(function* () {
    const owner = yield* repository.createPasswordUser({
      email: EmailAddress.make(email),
      name: email.split("@")[0] ?? "Owner",
      passwordHash: PASSWORD_HASH,
    });
    const membership = yield* repository.membershipForUser(owner.id);
    return { owner, membership };
  });

const sessionFor = (
  repository: AuthRepositoryApi,
  input: {
    readonly id: string;
    readonly userId: Parameters<AuthRepositoryApi["membershipForUser"]>[0];
    readonly organizationId: OrganizationId;
    readonly expiresAt: number;
  },
) =>
  repository.createSession({
    id: SessionId.make(input.id),
    familyId: `family-${input.id}`,
    userId: input.userId,
    activeOrganizationId: input.organizationId,
    refreshTokenHash: `hash-${input.id}`,
    client: { _tag: "Native", deviceName: "Front counter" },
    expiresAt: input.expiresAt,
  });

describe("refresh session reads and pruning on D1", () => {
  it("reads the session, its user, and the active membership in one lookup", async () => {
    const run = repositoryOn(authD1());
    const now = Date.now();
    const outcome = await run((repository) =>
      Effect.gen(function* () {
        const { owner, membership } = yield* seedOwner(repository, "owner@example.com");
        const other = yield* seedOwner(repository, "other@example.com");
        yield* sessionFor(repository, {
          id: "session-own",
          userId: owner.id,
          organizationId: membership.organizationId,
          expiresAt: now + 60_000,
        });
        yield* sessionFor(repository, {
          id: "session-foreign",
          userId: owner.id,
          organizationId: other.membership.organizationId,
          expiresAt: now + 60_000,
        });
        return {
          owner,
          membership,
          own: yield* repository.findRefreshContext(SessionId.make("session-own")),
          foreign: yield* repository.findRefreshContext(SessionId.make("session-foreign")),
          missing: yield* repository.findRefreshContext(SessionId.make("session-missing")),
        };
      }),
    );
    expect(outcome.own).toMatchObject({
      session: { id: "session-own", userId: outcome.owner.id, revokedAt: null },
      user: outcome.owner,
      activeMembership: outcome.membership,
    });
    expect(outcome.foreign?.user).toEqual(outcome.owner);
    expect(outcome.foreign?.activeMembership).toBeNull();
    expect(outcome.missing).toBeNull();
  });

  it("prunes only sessions past the retention cutoff, in bounded batches", async () => {
    const run = repositoryOn(authD1());
    const now = Date.now();
    const day = 24 * 60 * 60 * 1_000;
    const outcome = await run((repository) =>
      Effect.gen(function* () {
        const { owner, membership } = yield* seedOwner(repository, "owner@example.com");
        const seed = (id: string, expiresAt: number) =>
          sessionFor(repository, {
            id,
            userId: owner.id,
            organizationId: membership.organizationId,
            expiresAt,
          });
        yield* seed("expired-long-ago-1", now - 30 * day);
        yield* seed("expired-long-ago-2", now - 20 * day);
        yield* seed("expired-recently", now - day);
        yield* seed("live", now + day);
        yield* repository.revokeSession(SessionId.make("live"), now);
        const policy = { retainAfterExpiryMillis: 7 * day, batchRows: 1, maxBatches: 1 };
        const first = yield* pruneExpiredSessions(repository, policy);
        const second = yield* pruneExpiredSessions(repository, { ...policy, maxBatches: 5 });
        const remaining = yield* Effect.forEach(
          ["expired-long-ago-1", "expired-long-ago-2", "expired-recently", "live"],
          (id) => repository.findSession(SessionId.make(id)),
        );
        return { first, second, remaining };
      }),
    );
    expect(outcome.first).toEqual({ deleted: 1, batches: 1, more: true });
    expect(outcome.second).toEqual({ deleted: 1, batches: 2, more: false });
    expect(outcome.remaining.map((session) => session?.id ?? null)).toEqual([
      null,
      null,
      "expired-recently",
      "live",
    ]);
  });
});
