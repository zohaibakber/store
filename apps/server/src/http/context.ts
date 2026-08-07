import type { AuthSession } from "@store/auth";
import type { SyncRequest, SyncResponse } from "@store/contracts";

import type { ApiEnv } from "../../infra";
import type { SyncActor } from "../sync/model";

export type AuthApi = {
  getSession(options: { headers: Headers }): Promise<AuthSession | null>;
  getActiveMember(options: { headers: Headers }): Promise<object | null>;
};

export type SyncRunner = (actor: SyncActor, request: SyncRequest) => Promise<SyncResponse>;
export type SyncLiveConnector = (input: {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly authenticationExpiresAt: number;
}) => Promise<Response>;

export type AppEnv = {
  Bindings: ApiEnv;
  Variables: {
    authApi: AuthApi;
    authHandler: (request: Request) => Promise<Response>;
    runSync: SyncRunner;
    connectSyncLive: SyncLiveConnector;
    trustedOrigins: ReadonlyArray<string>;
    user: AuthSession["user"];
    session: AuthSession["session"];
    organizationId: string;
  };
};
