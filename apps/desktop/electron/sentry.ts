import { captureException, init } from "@sentry/electron/main";

import { sentryOptions } from "./sentry-options";

interface DesktopErrorContext {
  readonly op: string;
}

const unusedIntegrations = new Set([
  "MainProcessSession",
  "RendererEventLoopBlock",
  ...(process.platform === "linux" ? ["SentryMinidump"] : []),
]);

export const initDesktopSentry = () => {
  const options = sentryOptions();
  if (!options) return;
  init({
    ...options,
    integrations: (defaults) =>
      defaults.filter((integration) => !unusedIntegrations.has(integration.name)),
  });
};

export const reportDesktopError = (cause: unknown, context: DesktopErrorContext) => {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  console.error(error, context);
  captureException(error, { tags: { op: context.op } });
};
