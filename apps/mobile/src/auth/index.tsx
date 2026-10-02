import { nativeClient } from "@store/auth";
import Constants from "expo-constants";
import * as Network from "expo-network";
import * as React from "react";

import { mobileConfig } from "@/config";

import { createAuthController, toSession, type AuthController } from "./controller";
import { makeGoogleIdentity } from "./google";
import type { Session } from "./session";
import { secureSessionVault } from "./vault";

export type { SignedInSession } from "./session";
export type { IdentifyResult } from "./controller";
export { canRenameOrganization, type Account } from "./model";
export type { AuthProblem } from "./problems";

const SessionContext = React.createContext<Session>({ status: "loading" });
const ControllerContext = React.createContext<AuthController | null>(null);

const deviceLabel = () => {
  const device = Constants.deviceName?.trim();
  const label = device ? `Tabaaq Mobile on ${device}` : "Tabaaq Mobile";
  return label.slice(0, 100);
};

const createNativeAuthController = () =>
  createAuthController({
    apiBaseUrl: mobileConfig.apiBaseUrl,
    authBaseUrl: mobileConfig.authBaseUrl,
    fetch: (input, init) => globalThis.fetch(input, init),
    vault: secureSessionVault,
    isOnline: async () => {
      const state = await Network.getNetworkStateAsync();
      return state.isConnected !== false && state.isInternetReachable !== false;
    },
    google:
      mobileConfig.googleWebClientId === null
        ? null
        : makeGoogleIdentity(mobileConfig.googleWebClientId),
    client: nativeClient(deviceLabel()),
  });

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
