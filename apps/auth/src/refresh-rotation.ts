import * as Result from "effect/Result";

import { AuthRefusal } from "./failures";
import type { MembershipRecord, RefreshContext, SessionRecord, UserRecord } from "./repository";

export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const REUSE_WINDOW_MS = 90_000;
export const REPLAY_HOPS = 4;

interface PresentedSession {
  readonly revokedAt: number | null;
}

export interface LiveRefresh {
  readonly session: SessionRecord;
  readonly user: UserRecord;
  readonly activeMembership: MembershipRecord | null;
}

export type RefreshDisposition = "live" | "replay";

export const decidePresentedRefresh = (
  session: PresentedSession,
  now: number,
): Result.Result<RefreshDisposition, AuthRefusal> => {
  if (session.revokedAt === null) return Result.succeed("live");
  if (session.revokedAt + REUSE_WINDOW_MS <= now) {
    return Result.fail(new AuthRefusal({ reason: "RefreshReuseDetected" }));
  }
  return Result.succeed("replay");
};

export const decideLiveRefresh = (
  context: RefreshContext,
  now: number,
): Result.Result<LiveRefresh, AuthRefusal> => {
  if (context.session.expiresAt <= now) {
    return Result.fail(new AuthRefusal({ reason: "RefreshExpired" }));
  }
  if (!context.user) return Result.fail(new AuthRefusal({ reason: "AccountNotFound" }));
  return Result.succeed({
    session: context.session,
    user: context.user,
    activeMembership: context.activeMembership,
  });
};
