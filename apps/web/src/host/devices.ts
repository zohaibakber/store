import { OrganizationDevices, type DeviceCommand } from "@store/contracts";
import { SessionHttp, asRequestError, decodeResponse, type RequestError } from "@store/workspace";
import * as Effect from "effect/Effect";
import * as HttpBody from "effect/http/HttpBody";

export type DevicesBridge = {
  readonly list: () => Promise<OrganizationDevices>;
  readonly command: (command: DeviceCommand) => Promise<OrganizationDevices>;
};

const devicesUrl = (session: { readonly apiBaseUrl: string }) =>
  `${session.apiBaseUrl}/api/sync/devices`;

export const listOrganizationDevices: Effect.Effect<
  OrganizationDevices,
  RequestError,
  SessionHttp
> = SessionHttp.use((session) =>
  asRequestError(session.http.get(devicesUrl(session))).pipe(
    Effect.flatMap(decodeResponse(OrganizationDevices)),
  ),
);

export const commandOrganizationDevice = (
  command: DeviceCommand,
): Effect.Effect<OrganizationDevices, RequestError, SessionHttp> =>
  SessionHttp.use((session) =>
    asRequestError(
      session.http.post(devicesUrl(session), { body: HttpBody.jsonUnsafe(command) }),
    ).pipe(Effect.flatMap(decodeResponse(OrganizationDevices))),
  );
