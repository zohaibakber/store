import { WorkspaceSnapshot } from "@store/contracts";
import { syncGroup } from "@store/contracts/sync/api";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as Schema from "effect/Schema";

import { OrganizationAuth } from "../auth/organization";

const Health = Schema.Struct({ ok: Schema.Boolean });

const system = HttpApiGroup.make("system").add(
  HttpApiEndpoint.get("health", "/api/health", { success: Health }),
);

const auth = HttpApiGroup.make("auth").add(
  HttpApiEndpoint.get("session", "/api/auth/session", { success: WorkspaceSnapshot }),
);

export const StoreApi = HttpApi.make("StoreApi").add(
  system,
  auth,
  syncGroup.middleware(OrganizationAuth),
);
