import { WorkspaceSnapshot } from "@store/contracts";
import {
  BadRequest,
  globalSearchGroup,
  productScansGroup,
  uploadsGroup,
} from "@store/contracts/server-api";
import { syncGroup } from "@store/contracts/sync/api";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as Schema from "effect/Schema";

import { OrganizationAuth } from "../auth/organization";

export class ProductScanPayloadErrors extends HttpApiMiddleware.Service<ProductScanPayloadErrors>()(
  "@store/server/ProductScanPayloadErrors",
  { error: BadRequest },
) {}

export class GlobalSearchPayloadErrors extends HttpApiMiddleware.Service<GlobalSearchPayloadErrors>()(
  "@store/server/GlobalSearchPayloadErrors",
  { error: BadRequest },
) {}

const Landing = Schema.Struct({
  service: Schema.Literal("Store Invoice API"),
  endpoints: Schema.Array(Schema.String),
});

const ApiStatus = Schema.Struct({
  service: Schema.Literal("Store Invoice API"),
  ok: Schema.Boolean,
});

const Health = Schema.Struct({ ok: Schema.Boolean });

const system = HttpApiGroup.make("system")
  .add(HttpApiEndpoint.get("landing", "/", { success: Landing }))
  .add(HttpApiEndpoint.get("status", "/api", { success: ApiStatus }))
  .add(HttpApiEndpoint.get("health", "/api/health", { success: Health }));

const auth = HttpApiGroup.make("auth").add(
  HttpApiEndpoint.get("session", "/api/auth/session", { success: WorkspaceSnapshot }),
);

export const StoreApi = HttpApi.make("StoreApi").add(
  system,
  auth,
  uploadsGroup.middleware(OrganizationAuth),
  productScansGroup.middleware(OrganizationAuth).middleware(ProductScanPayloadErrors),
  globalSearchGroup.middleware(OrganizationAuth).middleware(GlobalSearchPayloadErrors),
  syncGroup.middleware(OrganizationAuth),
);
