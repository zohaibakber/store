import { makeAuthClient, nativeClient } from "@store/auth";
import * as Schema from "effect/Schema";
import Constants from "expo-constants";
import * as Network from "expo-network";
import * as React from "react";

import { MobileAuthExtra, authConfigFrom } from "./config";
import { createAuthController, toSession, type AuthController } from "./controller";
import { makeGoogleIdentity } from "./google";
import type { Session } from "./session";
import { secureSessionVault } from "./vault";

export type { Session, SessionOrganization, SignedInSession } from "./session";
export type {
  ActionResult,
  AuthController,
  GoogleSignInResult,
  IdentifyResult,
  SignInFlow,
} from "./controller";
export type { AuthField, AuthProblem, AuthProblemKind } from "./problems";

const SessionContext = React.createContext<Session>({ status: "loading" });
const ControllerContext = React.createContext<AuthController | null>(null);

const deviceLabel = () => {
  const device = Constants.deviceName?.trim();
  const label = device ? `Tabaaq Mobile on ${device}` : "Tabaaq Mobile";
  return label.slice(0, 100);
};

const createNativeAuthController = () => {
  const config = authConfigFrom(
    Schema.decodeUnknownSync(MobileAuthExtra)(Constants.expoConfig?.extra),
  );
  const send: typeof fetch = (input, init) => globalThis.fetch(input, init);
  return createAuthController({
    apiBaseUrl: config.apiBaseUrl,
    authBaseUrl: config.authBaseUrl,
    fetch: send,
    authClient: makeAuthClient({ baseUrl: config.authBaseUrl, fetch: send }),
    vault: secureSessionVault,
    isOnline: async () => {
      const state = await Network.getNetworkStateAsync();
      return state.isConnected !== false && state.isInternetReachable !== false;
    },
    google: config.googleWebClientId === null ? null : makeGoogleIdentity(config.googleWebClientId),
    client: nativeClient(deviceLabel()),
  });
};

export function AuthProvider({ children }: { readonly children: React.ReactNode }) {
  const [controller] = React.useState(createNativeAuthController);
  const { subscribe, getState, start } = controller;
  const state = React.useSyncExternalStore(subscribe, getState);
  const session = React.useMemo(() => toSession(state, controller), [state, controller]);

  React.useEffect(() => {
    void start();
  }, [start]);

  return (
    <ControllerContext value={controller}>
      <SessionContext value={session}>{children}</SessionContext>
    </ControllerContext>
  );
}

export const useSession = (): Session => React.use(SessionContext);

export const useAuthActions = (): AuthController => {
  const controller = React.use(ControllerContext);
  if (controller === null) throw new Error("useAuthActions must be used inside AuthProvider.");
  return controller;
};

export const useSignInFlow = () => {
  const { subscribeFlow, getFlow } = useAuthActions();
  return React.useSyncExternalStore(subscribeFlow, getFlow);
};
