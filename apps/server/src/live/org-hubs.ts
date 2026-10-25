import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { HttpServerError } from "effect/http/HttpServerError";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";

import type { CommitFanout } from "../authority/frames";

export class OrgHubs extends Context.Service<
  OrgHubs,
  {
    readonly getByName: (organizationId: string) => {
      readonly fetch: (
        request: HttpServerRequest.HttpServerRequest,
      ) => Effect.Effect<HttpServerResponse.HttpServerResponse, HttpServerError>;
      readonly publish: (input: CommitFanout) => Effect.Effect<number, unknown, RuntimeContext>;
    };
  }
>()("@store/server/OrgHubs") {}
