import {
  OrganizationCommandResult,
  OrganizationRoster,
  type OrganizationCommand,
} from "@store/auth";
import * as Schema from "effect/Schema";

import type { JsonApiResponse, JsonRequestInit } from "./workspace";

type AuthRequest = (pathname: string, init?: JsonRequestInit) => Promise<JsonApiResponse>;

export const fetchOrganizationRoster = async (authRequest: AuthRequest) =>
  Schema.decodeUnknownSync(OrganizationRoster)(await authRequest("/v1/organization"));

export const organizeOrganization = async (
  authRequest: AuthRequest,
  command: OrganizationCommand,
) =>
  Schema.decodeUnknownSync(OrganizationCommandResult)(
    await authRequest("/v1/organization", { method: "POST", body: command }),
  );
