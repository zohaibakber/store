import {
  AccessTokenService,
  RefreshToken,
  SessionId,
  sessionWorkspaceFromClaims,
  type AuthClientKind,
  type OrganizationId,
  type RefreshedSession,
  type UserId,
} from "@store/auth";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { AuthCrypto, REFRESH_TTL_MS } from "./crypto";
import {
  AccountNotFound,
  InvalidRefreshToken,
  RefreshExpired,
  RefreshRequired,
  RefreshReuseDetected,
  SessionRevoked,
  Unauthenticated,
} from "./failures";
import type { PresentedRefresh } from "./refresh-credential";
import {
  AuthRepository,
  type MembershipRecord,
  type SessionRecord,
  type UserRecord,
} from "./repository";
import { AuthSettings } from "./settings";

const REFRESH_REUSE_WINDOW_MS = 30_000;

const formatRefreshToken = (sessionId: SessionId, secret: Redacted.Redacted<string>) =>
  RefreshToken.make(`${sessionId}.${Redacted.value(secret)}`);

const parseRefreshToken = Effect.fnUntraced(function* (token: Redacted.Redacted<string>) {
  const presented = Redacted.value(token);
  const separator = presented.indexOf(".");
  if (separator <= 0 || separator === presented.length - 1) {
    return yield* new InvalidRefreshToken();
  }
  const sessionId = yield* Schema.decodeUnknownEffect(SessionId)(
    presented.slice(0, separator),
  ).pipe(Effect.mapError(() => new InvalidRefreshToken()));
  return { sessionId, secret: Redacted.make(presented.slice(separator + 1)) };
});

export class Sessions extends Context.Service<Sessions>()("@store/auth-worker/Sessions", {
  make: Effect.gen(function* () {
    const repository = yield* AuthRepository;
    const accessTokens = yield* AccessTokenService;
    const crypto = yield* AuthCrypto;
    const { refreshTokenPepper } = yield* AuthSettings;

    const hashSecret = (secret: Redacted.Redacted<string>) =>
      crypto.refreshHash(refreshTokenPepper, secret);

    const secretMatches = (secret: Redacted.Redacted<string>, storedHash: string) =>
      Effect.flatMap(hashSecret(secret), (actualHash) => crypto.matches(actualHash, storedHash));

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

    const accessClaims = (
      user: UserRecord,
      sessionId: SessionId,
      membership: MembershipRecord,
      now: number,
    ) => ({
      subject: user.id,
      sessionId,
      activeOrganizationId: membership.organizationId,
      organizationName: membership.organizationName,
      role: membership.role,
      email: user.email,
      name: user.name,
      image: user.image,
      now,
    });

    const issueTokens = Effect.fn("Auth.Session.issueTokens")(function* (input: {
      readonly user: UserRecord;
      readonly sessionId: SessionId;
      readonly membership: MembershipRecord;
      readonly refreshSecret: Redacted.Redacted<string>;
      readonly refreshExpiresAt: number;
      readonly now: number;
    }) {
      const claims = accessClaims(input.user, input.sessionId, input.membership, input.now);
      const access = yield* accessTokens.issue(claims);
      return {
        accessToken: access.token,
        accessExpiresAt: access.expiresAt,
        refreshToken: formatRefreshToken(input.sessionId, input.refreshSecret),
        refreshExpiresAt: input.refreshExpiresAt,
        workspace: sessionWorkspaceFromClaims(claims),
      } satisfies RefreshedSession;
    });

    const issueSession = Effect.fn("Auth.Session.issueSession")(function* (
      user: UserRecord,
      client: AuthClientKind,
      replayKey?: string,
    ) {
      const now = yield* Clock.currentTimeMillis;
      const membership = yield* resolveMembership(user.id);
      const sessionId = SessionId.make(replayKey ?? (yield* crypto.randomId));
      const familyId = yield* crypto.randomId;
      const refreshSecret = yield* crypto.randomSecret(32);
      const refreshTokenHash = yield* hashSecret(refreshSecret);
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
      return yield* issueTokens({
        user,
        sessionId,
        membership,
        refreshSecret,
        refreshExpiresAt,
        now,
      });
    });

    const openRefresh = Effect.fn("Auth.Session.openRefresh")(function* (
      presented: PresentedRefresh | undefined,
    ) {
      const now = yield* Clock.currentTimeMillis;
      if (!presented) {
        return yield* new RefreshRequired();
      }
      const parsed = yield* parseRefreshToken(presented.refreshToken);
      const context = yield* repository.findRefreshContext(parsed.sessionId);
      if (!context) {
        return yield* new InvalidRefreshToken();
      }
      const current = context.session;
      if (!(yield* secretMatches(parsed.secret, current.refreshTokenHash))) {
        return yield* new InvalidRefreshToken();
      }
      if (current.clientKind !== presented.client._tag) {
        return yield* new InvalidRefreshToken();
      }
      if (current.revokedAt !== null) {
        if (current.revokedAt + REFRESH_REUSE_WINDOW_MS > now) {
          return yield* new InvalidRefreshToken();
        }
        yield* repository.revokeFamily(current.familyId, now);
        return yield* new RefreshReuseDetected();
      }
      if (current.expiresAt <= now) {
        return yield* new RefreshExpired();
      }
      if (!context.user) {
        return yield* new AccountNotFound();
      }
      return { session: current, user: context.user, activeMembership: context.activeMembership };
    });

    const rotateInto = Effect.fn("Auth.Session.rotateInto")(function* (input: {
      readonly session: SessionRecord;
      readonly user: UserRecord;
      readonly membership: MembershipRecord;
    }) {
      const now = yield* Clock.currentTimeMillis;
      const nextId = SessionId.make(yield* crypto.randomId);
      const nextSecret = yield* crypto.randomSecret(32);
      const nextHash = yield* hashSecret(nextSecret);
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
        return yield* new InvalidRefreshToken();
      }
      return yield* issueTokens({
        user: input.user,
        sessionId: nextId,
        membership: input.membership,
        refreshSecret: nextSecret,
        refreshExpiresAt,
        now,
      });
    });

    const refresh = Effect.fn("Auth.Session.refresh")(function* (
      presented: PresentedRefresh | undefined,
    ) {
      const open = yield* openRefresh(presented);
      const membership =
        open.activeMembership ?? (yield* repository.membershipForUser(open.user.id));
      return yield* rotateInto({ session: open.session, user: open.user, membership });
    });

    const signOut = Effect.fn("Auth.Session.signOut")(function* (
      refreshToken: Redacted.Redacted<string> | undefined,
    ) {
      const now = yield* Clock.currentTimeMillis;
      if (!refreshToken) return;
      const parsed = yield* parseRefreshToken(refreshToken);
      const session = yield* repository.findSession(parsed.sessionId);
      if (!session) return;
      if (!(yield* secretMatches(parsed.secret, session.refreshTokenHash))) return;
      yield* repository.revokeSession(session.id, now);
    });

    const authorize = Effect.fn("Auth.Session.authorize")(function* (
      accessToken: Redacted.Redacted<string>,
    ) {
      const now = yield* Clock.currentTimeMillis;
      const claims = yield* accessTokens
        .verify(Redacted.value(accessToken), now)
        .pipe(Effect.mapError(() => new Unauthenticated()));
      const session = yield* repository.findSession(claims.sessionId);
      if (!session || session.revokedAt !== null || session.expiresAt <= now) {
        return yield* new SessionRevoked();
      }
      return claims;
    });

    return { issueSession, refresh, signOut, authorize };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
