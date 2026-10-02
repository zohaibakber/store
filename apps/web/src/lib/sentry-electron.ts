import { init } from "@sentry/electron/renderer";
import { init as reactInit } from "@sentry/react";

export const initElectronSentry = () => {
  if (!import.meta.env.VITE_SENTRY_DSN?.trim()) return;
  init({}, reactInit);
};
