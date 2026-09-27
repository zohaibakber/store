import { AuthClientError } from "@store/auth";
import { RequestError } from "@store/workspace";

export type AuthProblemKind =
  | "offline"
  | "unavailable"
  | "wrongCode"
  | "expiredCode"
  | "wrongPassword"
  | "rateLimited"
  | "sessionEnded"
  | "invalid"
  | "rejected";

export type AuthField = "email" | "code" | "password" | "name" | "organizationName" | "invitation";

export interface AuthProblem {
  readonly kind: AuthProblemKind;
  readonly message: string;
  readonly field?: AuthField;
}

export interface FailureFacts {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export interface FailureContext {
  readonly online: boolean;
  readonly now: number;
  readonly codeIssuedAt?: number;
}

export const CODE_LIFETIME_MS = 10 * 60 * 1_000;

const NETWORK_ERROR = "NETWORK_ERROR";

const sessionEndedCodes = new Set([
  "REFRESH_REQUIRED",
  "INVALID_REFRESH_TOKEN",
  "REFRESH_REUSE_DETECTED",
  "REFRESH_EXPIRED",
  "SESSION_REVOKED",
  "ACCOUNT_NOT_FOUND",
  "UNAUTHENTICATED",
]);

export const problem = (kind: AuthProblemKind, message: string): AuthProblem => ({
  kind,
  message,
});

export const invalid = (message: string, field?: AuthField): AuthProblem =>
  field === undefined ? problem("invalid", message) : { kind: "invalid", message, field };

export const failureFacts = (cause: unknown): FailureFacts => {
  if (cause instanceof AuthClientError) {
    return { status: cause.status, code: cause.code, message: cause.message };
  }
  if (cause instanceof RequestError) {
    return { status: cause.status, code: cause.code ?? "", message: cause.message };
  }
  return {
    status: 0,
    code: NETWORK_ERROR,
    message: cause instanceof Error ? cause.message : "The request failed.",
  };
};

export const isNetworkFailure = (facts: FailureFacts) =>
  facts.status === 0 && facts.code === NETWORK_ERROR;

export const endsSession = (facts: FailureFacts) =>
  facts.status === 401 && sessionEndedCodes.has(facts.code);

export const rejectsRefresh = (facts: FailureFacts) => facts.status === 401 || facts.status === 403;

export const describeFailure = (facts: FailureFacts, context: FailureContext): AuthProblem => {
  if (isNetworkFailure(facts)) {
    return context.online
      ? problem("unavailable", "Can't reach Tabaaq right now. Try again in a moment.")
      : problem("offline", "You're offline. Connect to the internet and try again.");
  }
  if (facts.status === 0) return invalid(facts.message);
  if (facts.status === 429) {
    return problem("rateLimited", "Too many tries. Wait a minute, then try again.");
  }
  if (facts.status >= 500) {
    return problem("unavailable", "Sign-in isn't available right now. Try again in a moment.");
  }
  if (facts.code === "INVALID_OTP") {
    const expired =
      context.codeIssuedAt !== undefined && context.now - context.codeIssuedAt >= CODE_LIFETIME_MS;
    return expired
      ? { kind: "expiredCode", message: "This code has expired. Send a new code.", field: "code" }
      : {
          kind: "wrongCode",
          message: "That code isn't right. Check it and try again.",
          field: "code",
        };
  }
  if (facts.code === "INVALID_CREDENTIALS") {
    return { kind: "wrongPassword", message: "That password isn't right.", field: "password" };
  }
  if (endsSession(facts)) {
    return problem("sessionEnded", "Your session ended. Sign in again.");
  }
  return problem("rejected", facts.message);
};
