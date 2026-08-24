import {
  RefreshToken,
  SessionId,
  TokenSet,
  type AccessTokenServiceApi,
  type AuthClientKind,
  type OrganizationId,
  type RefreshInput,
  type SignOutInput,
  type UserId,
} from "@store/auth";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import { parseRefreshToken, randomSecret, REFRESH_TTL_MS, safeEqual, sha256 } from "./crypto";
import { authError } from "./errors";
import {
  type AuthRepositoryApi,
  type MembershipRecord,
  type SessionRecord,
  type UserRecord,
} from "./repository";

export interface SessionOpsConfiguration {
  readonly refreshTokenPepper: string;
}

export const makeSessionOps = (
  repository: AuthRepositoryApi,
  accessTokens: AccessTokenServiceApi,
  configuration: SessionOpsConfiguration,
) => {
  /**
   * The organization the caller asked for, when they still belong to it,
   * and otherwise their first one. A session that names an organization
   * the user has left must not keep refreshing into it.
   */
  const resolveMembership = Effect.fn("Auth.Session.resolveMembership")(function* (
    userId: UserId,
    preferred?: OrganizationId,
  ) {
    if (preferred) {
      const membership = yield* repository.membershipInOrganization({
        userId,
        organizationId: preferred,
      });
      if (membership) return membership;
    }
    return yield* repository.membershipForUser(userId);
  });

  const issueAccess = (
    user: UserRecord,
    sessionId: SessionId,
    membership: MembershipRecord,
    now: number,
  ) =>
    accessTokens.issue({
      subject: user.id,
      sessionId,
      activeOrganizationId: membership.organizationId,
      organizationName: membership.organizationName,
      organizationSlug: membership.organizationSlug,
      role: membership.role,
      email: user.email,
      name: user.name,
      image: user.image,
      now,
    });

  const issueSession = Effect.fn("Auth.Session.issueSession")(function* (
    user: UserRecord,
    client: AuthClientKind,
    replayKey?: string,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const membership = yield* resolveMembership(user.id);
    const sessionId = SessionId.make(replayKey ?? crypto.randomUUID());
    const familyId = crypto.randomUUID();
    const refreshSecret = randomSecret(32);
    const refreshTokenHash = yield* sha256(`${configuration.refreshTokenPepper}:${refreshSecret}`);
    const refreshExpiresAt = now + REFRESH_TTL_MS;
    yield* repository.createSession({
      id: sessionId,
      familyId,
      userId: user.id,
      activeOrganizationId: membership.organizationId,
      refreshTokenHash,
      client,
      expiresAt: refreshExpiresAt,
    });
    const access = yield* issueAccess(user, sessionId, membership, now);
    return TokenSet.make({
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken: RefreshToken.make(`${sessionId}.${refreshSecret}`),
      refreshExpiresAt,
    });
  });

  /**
   * Two tabs often refresh the same live token at once. The loser sees a
   * just-revoked row. Treat that as a lost race for a short window instead of
   * killing the winner's new session. Presenting the same revoked token after
   * the window still burns the family, which is the stolen-token rule.
   */
  const REFRESH_REUSE_GRACE_MS = 30_000;

  const openRefresh = Effect.fn("Auth.Session.openRefresh")(function* (
    refreshToken: string | undefined,
  ) {
    const now = yield* Clock.currentTimeMillis;
    if (!refreshToken) {
      return yield* authError(401, "REFRESH_REQUIRED", "The session has expired.");
    }
    const parsed = yield* parseRefreshToken(refreshToken);
    const current = yield* repository.findSession(parsed.sessionId);
    if (!current) {
      return yield* authError(401, "INVALID_REFRESH_TOKEN", "The session has expired.");
    }
    const actualHash = yield* sha256(`${configuration.refreshTokenPepper}:${parsed.secret}`);
    if (!safeEqual(actualHash, current.refreshTokenHash)) {
      return yield* authError(401, "INVALID_REFRESH_TOKEN", "The session has expired.");
    }
    if (current.revokedAt !== null) {
      if (current.revokedAt + REFRESH_REUSE_GRACE_MS > now) {
        return yield* authError(401, "INVALID_REFRESH_TOKEN", "The session has expired.");
      }
      yield* repository.revokeFamily(current.familyId, now);
      return yield* authError(
        401,
        "REFRESH_REUSE_DETECTED",
        "This session was revoked. Sign in again.",
      );
    }
    if (current.expiresAt <= now) {
      return yield* authError(401, "REFRESH_EXPIRED", "The session has expired.");
    }
    const user = yield* repository.findUserById(current.userId);
    if (!user) {
      return yield* authError(401, "ACCOUNT_NOT_FOUND", "The account no longer exists.");
    }
    return { session: current, user };
  });

  const rotateInto = Effect.fn("Auth.Session.rotateInto")(function* (input: {
    readonly session: SessionRecord;
    readonly user: UserRecord;
    readonly membership: MembershipRecord;
  }) {
    const now = yield* Clock.currentTimeMillis;
    const nextId = SessionId.make(crypto.randomUUID());
    const nextSecret = randomSecret(32);
    const nextHash = yield* sha256(`${configuration.refreshTokenPepper}:${nextSecret}`);
    const refreshExpiresAt = now + REFRESH_TTL_MS;
    const rotated = yield* repository.rotateSession({
      currentId: input.session.id,
      now,
      replacement: {
        id: nextId,
        familyId: input.session.familyId,
        userId: input.session.userId,
        activeOrganizationId: input.membership.organizationId,
        refreshTokenHash: nextHash,
        client:
          input.session.clientKind === "Browser"
            ? { _tag: "Browser" }
            : { _tag: "Native", deviceName: input.session.deviceName ?? "Native client" },
        expiresAt: refreshExpiresAt,
      },
    });
    if (!rotated) {
      return yield* authError(401, "INVALID_REFRESH_TOKEN", "The session has expired.");
    }
    const access = yield* issueAccess(input.user, nextId, input.membership, now);
    return TokenSet.make({
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken: RefreshToken.make(`${nextId}.${nextSecret}`),
      refreshExpiresAt,
    });
  });

  const refresh = Effect.fn("Auth.Session.refresh")(function* (input: RefreshInput) {
    const open = yield* openRefresh(input.refreshToken);
    const membership = yield* resolveMembership(open.user.id, open.session.activeOrganizationId);
    return yield* rotateInto({ ...open, membership });
  });

  const signOut = Effect.fn("Auth.Session.signOut")(function* (input: SignOutInput) {
    const now = yield* Clock.currentTimeMillis;
    if (!input.refreshToken) return;
    const parsed = yield* parseRefreshToken(input.refreshToken);
    const session = yield* repository.findSession(parsed.sessionId);
    if (!session) return;
    const actualHash = yield* sha256(`${configuration.refreshTokenPepper}:${parsed.secret}`);
    if (!safeEqual(actualHash, session.refreshTokenHash)) return;
    if (input.everywhere) yield* repository.revokeUser(session.userId, now);
    else yield* repository.revokeSession(session.id, now);
  });

  /**
   * Resolves a bearer access token to its claims, and confirms the session
   * behind it is still live. The token is short-lived, but a membership
   * change or a sign-out everywhere must take effect before it expires.
   */
  const authorize = Effect.fn("Auth.Session.authorize")(function* (accessToken: string) {
    const now = yield* Clock.currentTimeMillis;
    const claims = yield* accessTokens
      .verify(accessToken, now)
      .pipe(Effect.mapError(() => authError(401, "UNAUTHENTICATED", "Sign in to continue.")));
    const session = yield* repository.findSession(claims.sessionId);
    if (!session || session.revokedAt !== null || session.expiresAt <= now) {
      return yield* authError(401, "SESSION_REVOKED", "This session has ended. Sign in again.");
    }
    return claims;
  });

  return { issueSession, refresh, signOut, authorize };
};

export type SessionOps = ReturnType<typeof makeSessionOps>;
