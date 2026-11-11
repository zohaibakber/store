import { describe, expect, it } from "@effect/vitest";
import { EmailAddress, PasswordHash, SessionId, type OrganizationId } from "@store/auth";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import { SessionFamilyId } from "../src/identifiers";
import { AuthRepository } from "../src/repository";
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
});
