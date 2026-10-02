import { captureException } from "@sentry/react";

interface ReportedErrorContext {
  readonly op: string;
}

const asError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

export const reportError = (cause: unknown, context: ReportedErrorContext) => {
  const error = asError(cause);
  console.error(error, context);
  captureException(error, { tags: { op: context.op } });
};
