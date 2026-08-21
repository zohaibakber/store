import {
  OrganizationCommandResult,
  OrganizationRoster,
  type OrganizationCommand,
} from "@store/auth";
import * as Schema from "effect/Schema";

import type { JsonApiResponse, JsonRequestInit } from "./workspace";

type AuthRequest = (pathname: string, init?: JsonRequestInit) => Promise<JsonApiResponse>;

/** Shared org roster decode used by web bridge and desktop IPC. */
export const fetchOrganizationRoster = async (authRequest: AuthRequest) =>
  Schema.decodeUnknownSync(OrganizationRoster)(await authRequest("/v1/organization"));

/** Shared organize command decode used by web bridge and desktop IPC. */
export const organizeOrganization = async (
  authRequest: AuthRequest,
  command: OrganizationCommand,
) =>
  Schema.decodeUnknownSync(OrganizationCommandResult)(
    await authRequest("/v1/organization", { method: "POST", body: command }),
  );
