import {
  AccessTokenService,
  RefreshToken,
  SessionId,
  sessionWorkspaceFromClaims,
  type AuthClientKind,
  type RefreshedSession,
} from "@store/auth";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { AuthCrypto, REFRESH_TTL_MS } from "./crypto";
import { AuthRefusal } from "./failures";
import {
  AuthRepository,
  type MembershipRecord,
  type RefreshContext,
  type RepositoryError,
  type SessionRecord,
  type UserRecord,
} from "./repository";
import { AuthSettings } from "./settings";

const REFRESH_REUSE_WINDOW_MS = 90_000;
const REFRESH_REPLAY_HOPS = 4;

export interface PresentedRefresh {
  readonly client: AuthClientKind;
  readonly refreshToken: Redacted.Redacted<string>;
}

const formatRefreshToken = (sessionId: SessionId, secret: Redacted.Redacted<string>) =>
  RefreshToken.make(`${sessionId}.${Redacted.value(secret)}`);

const parseRefreshToken = Effect.fnUntraced(function* (token: Redacted.Redacted<string>) {
  const presented = Redacted.value(token);
  const separator = presented.indexOf(".");
  if (separator <= 0 || separator === presented.length - 1) {
    return yield* new AuthRefusal({ reason: "InvalidRefreshToken" });
  }
  const sessionId = yield* Schema.decodeUnknownEffect(SessionId)(
    presented.slice(0, separator),
  ).pipe(Effect.mapError(() => new AuthRefusal({ reason: "InvalidRefreshToken" })));
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
      const membership = yield* repository.membershipForUser(user.id);
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

    const liveRefresh = Effect.fnUntraced(function* (context: RefreshContext, now: number) {
      if (context.session.expiresAt <= now) {
        return yield* new AuthRefusal({ reason: "RefreshExpired" });
      }
      if (!context.user) {
        return yield* new AuthRefusal({ reason: "AccountNotFound" });
      }
      return {
        session: context.session,
        user: context.user,
        activeMembership: context.activeMembership,
      };
    });

    const liveSuccessor: (
      revoked: SessionRecord,
      hops: number,
    ) => Effect.Effect<RefreshContext | null, RepositoryError> = Effect.fnUntraced(
      function* (revoked, hops) {
        if (hops === 0 || revoked.replacedBySessionId === null) return null;
        const successor = yield* repository.findRefreshContext(revoked.replacedBySessionId);
        if (!successor) return null;
        return successor.session.revokedAt === null
          ? successor
          : yield* liveSuccessor(successor.session, hops - 1);
      },
    );

    const openRefresh = Effect.fn("Auth.Session.openRefresh")(function* (
      presented: PresentedRefresh | undefined,
    ) {
      const now = yield* Clock.currentTimeMillis;
      if (!presented) {
        return yield* new AuthRefusal({ reason: "RefreshRequired" });
      }
      const parsed = yield* parseRefreshToken(presented.refreshToken);
      const context = yield* repository.findRefreshContext(parsed.sessionId);
      if (!context) {
        return yield* new AuthRefusal({ reason: "InvalidRefreshToken" });
      }
      const current = context.session;
      if (!(yield* secretMatches(parsed.secret, current.refreshTokenHash))) {
        return yield* new AuthRefusal({ reason: "InvalidRefreshToken" });
      }
      if (current.clientKind !== presented.client._tag) {
        return yield* new AuthRefusal({ reason: "InvalidRefreshToken" });
      }
      if (current.revokedAt === null) {
        return yield* liveRefresh(context, now);
      }
      if (current.revokedAt + REFRESH_REUSE_WINDOW_MS <= now) {
        yield* repository.revokeFamily(current.familyId, now);
        return yield* new AuthRefusal({ reason: "RefreshReuseDetected" });
      }
      const successor = yield* liveSuccessor(current, REFRESH_REPLAY_HOPS);
      if (!successor) {
        return yield* new AuthRefusal({ reason: "InvalidRefreshToken" });
      }
      return yield* liveRefresh(successor, now);
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
        return yield* new AuthRefusal({ reason: "InvalidRefreshToken" });
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
      yield* repository.revokeFamily(session.familyId, now);
    });

    const authorize = Effect.fn("Auth.Session.authorize")(function* (
      accessToken: Redacted.Redacted<string>,
    ) {
      const now = yield* Clock.currentTimeMillis;
      const claims = yield* accessTokens
        .verify(Redacted.value(accessToken), now)
        .pipe(Effect.mapError(() => new AuthRefusal({ reason: "Unauthenticated" })));
      const session = yield* repository.findSession(claims.sessionId);
      if (!session || session.revokedAt !== null || session.expiresAt <= now) {
        return yield* new AuthRefusal({ reason: "SessionRevoked" });
      }
      return claims;
    });

    return { issueSession, refresh, signOut, authorize };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
