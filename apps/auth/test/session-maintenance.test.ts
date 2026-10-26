import { describe, expect, it } from "@effect/vitest";
import { EmailAddress, PasswordHash, SessionId, type OrganizationId } from "@store/auth";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import { SessionFamilyId } from "../src/identifiers";
import { AuthRepository } from "../src/repository";
import { pruneExpiredSessions } from "../src/session-maintenance";
import { scenario } from "./harness";

const PASSWORD_HASH = PasswordHash.make("pbkdf2-sha256$100000$c2FsdA$aGFzaA");

const seedOwner = (repository: AuthRepository["Service"], email: string) =>
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
  repository: AuthRepository["Service"],
  input: {
    readonly id: string;
    readonly userId: Parameters<AuthRepository["Service"]["membershipForUser"]>[0];
    readonly organizationId: OrganizationId;
    readonly expiresAt: number;
  },
) =>
  repository.createSession({
    id: SessionId.make(input.id),
    familyId: SessionFamilyId.make(`family-${input.id}`),
    userId: input.userId,
    activeOrganizationId: input.organizationId,
    refreshTokenHash: `hash-${input.id}`,
    client: { _tag: "Native", deviceName: "Front counter" },
    expiresAt: input.expiresAt,
  });

describe("refresh session reads and pruning on D1", () => {
  it.effect("gives a session no membership in an organization its user does not belong to", () =>
    Effect.gen(function* () {
      const repository = yield* AuthRepository;
      const now = yield* Clock.currentTimeMillis;
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
      const own = yield* repository.findRefreshContext(SessionId.make("session-own"));
      const foreign = yield* repository.findRefreshContext(SessionId.make("session-foreign"));
      const missing = yield* repository.findRefreshContext(SessionId.make("session-missing"));

      expect(own).toMatchObject({
        session: { id: "session-own", userId: owner.id, revokedAt: null },
        user: owner,
        activeMembership: membership,
      });
      expect(foreign?.user).toEqual(owner);
      expect(foreign?.activeMembership).toBeNull();
      expect(missing).toBeNull();
    }).pipe(scenario()),
  );

  it.effect("prunes only sessions past the retention cutoff, in bounded batches", () =>
    Effect.gen(function* () {
      const repository = yield* AuthRepository;
      const day = 24 * 60 * 60 * 1_000;
      yield* TestClock.adjust("60 days");
      const now = yield* Clock.currentTimeMillis;
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
      yield* repository.revokeFamily(SessionFamilyId.make("family-live"), now);
      const policy = { retainAfterExpiryMillis: 7 * day, batchRows: 1, maxBatches: 1 };
      const first = yield* pruneExpiredSessions(repository, policy);
      const second = yield* pruneExpiredSessions(repository, { ...policy, maxBatches: 5 });
      const remaining = yield* Effect.forEach(
        ["expired-long-ago-1", "expired-long-ago-2", "expired-recently", "live"],
        (id) => repository.findSession(SessionId.make(id)),
      );

      expect(first).toEqual({ deleted: 1, batches: 1, more: true });
      expect(second).toEqual({ deleted: 1, batches: 2, more: false });
      expect(remaining.map((session) => session?.id ?? null)).toEqual([
        null,
        null,
        "expired-recently",
        "live",
      ]);
    }).pipe(scenario()),
  );
});
