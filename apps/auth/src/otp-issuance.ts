import { OtpChallengeId } from "@store/auth";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const OTP_TTL_MS = 10 * 60 * 1_000;
export const OTP_FAILURE_BUDGET = 5;
const REISSUE_COOLDOWN_MS = 30_000;
const ISSUE_WINDOW_MS = 60 * 60 * 1_000;
const ISSUES_PER_WINDOW = 5;

export const OtpIssuance = Schema.Struct({
  challengeId: OtpChallengeId,
  challengeKey: Schema.String,
  issuedAt: Schema.Int,
  windowStartedAt: Schema.Int,
  issued: Schema.Int,
});
export interface OtpIssuance extends Schema.Schema.Type<typeof OtpIssuance> {}

export interface OtpIssuanceWindow {
  readonly windowStartedAt: number;
  readonly issued: number;
}

export type OtpIssuanceDecision =
  | { readonly _tag: "Throttled"; readonly spent: boolean; readonly previous: OtpIssuance }
  | { readonly _tag: "Fresh" };

const carriedIssuance = (previous: Option.Option<OtpIssuance>, now: number) =>
  Option.filter(previous, (issuance) => issuance.windowStartedAt + ISSUE_WINDOW_MS > now);

export const decideOtpIssuance = (
  previous: Option.Option<OtpIssuance>,
  now: number,
  metered: boolean,
): OtpIssuanceDecision => {
  if (!metered || Option.isNone(previous)) return { _tag: "Fresh" };
  const cooling = previous.value.issuedAt + REISSUE_COOLDOWN_MS > now;
  const spent = Option.exists(
    carriedIssuance(previous, now),
    (issuance) => issuance.issued >= ISSUES_PER_WINDOW,
  );
  return cooling || spent
    ? { _tag: "Throttled", spent, previous: previous.value }
    : { _tag: "Fresh" };
};

export const nextIssuanceWindow = (
  previous: Option.Option<OtpIssuance>,
  now: number,
): OtpIssuanceWindow =>
  Option.match(carriedIssuance(previous, now), {
    onNone: () => ({ windowStartedAt: now, issued: 1 }),
    onSome: (issuance) => ({
      windowStartedAt: issuance.windowStartedAt,
      issued: issuance.issued + 1,
    }),
  });

export const issuanceRecordExpiresAt = (windowStartedAt: number, challengeExpiresAt: number) =>
  Math.max(windowStartedAt + ISSUE_WINDOW_MS, challengeExpiresAt);
