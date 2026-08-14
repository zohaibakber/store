import { createAuthClient } from "better-auth/client";
import { organizationClient } from "better-auth/client/plugins";

export interface WebAuthClientConfig {
  readonly baseURL: string;
}

export const makeWebAuthClient = (config: WebAuthClientConfig) => {
  const baseURL = config.baseURL.replace(/\/api\/?$/, "").replace(/\/$/, "");

  return createAuthClient({
    ...(baseURL ? { baseURL } : {}),
    fetchOptions: {
      credentials: "include",
    },
    plugins: [organizationClient()],
  });
};

export type WebAuthClient = ReturnType<typeof makeWebAuthClient>;
