import { Sentry } from "@/lib/sentry";

export interface ReportedErrorContext {
  readonly op: string;
  readonly scopeId?: string;
}

export const asError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error(String(cause));

export const reportError = (cause: unknown, context: ReportedErrorContext) => {
  const error = asError(cause);
  console.error(error, context);
  Sentry.withScope((scope) => {
    scope.setTag("op", context.op);
    if (context.scopeId) scope.setTag("scopeId", context.scopeId);
    Sentry.captureException(error);
  });
};
