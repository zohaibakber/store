import type { DeviceCommand, OrganizationDevices } from "@store/contracts";
import { SyncHttpApi } from "@store/contracts/sync/api";
import { SessionHttp, asRequestError, type RequestError } from "@store/workspace";
import * as Effect from "effect/Effect";
import * as HttpApiClient from "effect/http-api/HttpApiClient";

export type DevicesBridge = {
  readonly list: () => Promise<OrganizationDevices>;
  readonly command: (command: DeviceCommand) => Promise<OrganizationDevices>;
};

const syncApi = SessionHttp.use((session) =>
  HttpApiClient.group(SyncHttpApi, {
    group: "sync",
    httpClient: session.http,
    baseUrl: session.apiBaseUrl,
  }),
);

export const listOrganizationDevices: Effect.Effect<
  OrganizationDevices,
  RequestError,
  SessionHttp
> = Effect.flatMap(syncApi, (sync) => asRequestError(sync.listDevices()));

export const commandOrganizationDevice = (
  command: DeviceCommand,
): Effect.Effect<OrganizationDevices, RequestError, SessionHttp> =>
  Effect.flatMap(syncApi, (sync) => {
    switch (command._tag) {
      case "IgnoreDevice":
        return asRequestError(sync.commandDevice({ payload: command }));
      case "HeedDevice":
        return asRequestError(sync.commandDevice({ payload: command }));
      case "RemoveDevice":
        return asRequestError(sync.commandDevice({ payload: command }));
    }
  });
