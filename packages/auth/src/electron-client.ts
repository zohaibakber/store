import { electronClient } from "@better-auth/electron/client";
import { storage } from "@better-auth/electron/storage";
import { createAuthClient } from "better-auth/client";
import { organizationClient } from "better-auth/client/plugins";
import { net } from "electron";

export interface ElectronAuthClientConfig {
  readonly baseURL: string;
  readonly protocol: string;
}

export const makeElectronAuthClient = (config: ElectronAuthClientConfig) => {
  const baseURL = config.baseURL.replace(/\/api\/?$/, "").replace(/\/$/, "");

  return createAuthClient({
    baseURL,
    fetchOptions: {
      customFetchImpl: (input, init) =>
        net.fetch(input instanceof URL ? input.toString() : input, init),
    },
    plugins: [
      organizationClient(),
      electronClient({
        clientID: "store-electron",
        protocol: { scheme: config.protocol },
        signInURL: `${baseURL}/sign-in`,
        storage: storage(),
      }),
    ],
  });
};

export type ElectronAuthClient = ReturnType<typeof makeElectronAuthClient>;
