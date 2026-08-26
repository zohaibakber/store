import * as Sentry from "@sentry/react-native";
import { isRunningInExpoGo } from "expo";
import Constants from "expo-constants";

const sentryDsn = () => process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() ?? "";

export const initMobileSentry = () => {
  const dsn = sentryDsn();
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: __DEV__ ? "development" : "production",
    release: `tabaaq-mobile@${Constants.expoConfig?.version ?? "0.0.0"}`,
    sendDefaultPii: false,
    tracesSampleRate: __DEV__ ? 1.0 : 0.1,
    enableNativeFramesTracking: !isRunningInExpoGo(),
    integrations: [
      Sentry.expoRouterIntegration({
        enableTimeToInitialDisplay: !isRunningInExpoGo(),
      }),
    ],
  });
};

export { Sentry };
