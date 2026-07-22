import type { AuthSession } from "@store/auth";
import type { SyncRequest, SyncResponse } from "@store/contracts";
import type { SyncActor } from "../sync/model";

export type AuthApi = {
  getSession(options: { headers: Headers }): Promise<AuthSession | null>;
  getActiveMember(options: { headers: Headers }): Promise<object | null>;
};

export type SyncRunner = (actor: SyncActor, request: SyncRequest) => Promise<SyncResponse>;

export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    authApi: AuthApi;
    authHandler: (request: Request) => Promise<Response>;
    runSync: SyncRunner;
    trustedOrigins: ReadonlyArray<string>;
    user: AuthSession["user"];
    session: AuthSession["session"];
    organizationId: string;
  };
};
