import { Sentry } from "@/lib/sentry";

export interface ReportedErrorContext {
  readonly op: string;
}

export const asError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error(String(cause));

/** Auth UI catches failures so they never become unhandled; send those to Sentry. */
export const reportError = (cause: unknown, context: ReportedErrorContext) => {
  const error = asError(cause);
  console.error(error, context);
  Sentry.withScope((scope) => {
    scope.setTag("op", context.op);
    Sentry.captureException(error);
  });
};
