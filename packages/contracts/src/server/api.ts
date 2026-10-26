import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as Schema from "effect/Schema";

import { publicErrorSchema } from "../http-errors";
import { GlobalProductSearchInput, GlobalProductSearchResult } from "./schema";

const statusByTag = {
  BadRequest: 400,
  TooManyRequests: 429,
  BadGateway: 502,
} as const;

export const BadRequest = publicErrorSchema("BadRequest", statusByTag.BadRequest);
export type BadRequest = typeof BadRequest.Type;

export const TooManyRequests = publicErrorSchema("TooManyRequests", statusByTag.TooManyRequests);
export type TooManyRequests = typeof TooManyRequests.Type;

export const BadGateway = publicErrorSchema("BadGateway", statusByTag.BadGateway);
export type BadGateway = typeof BadGateway.Type;

export const ServerHttpError = Schema.Union([BadRequest, TooManyRequests, BadGateway]);
export type ServerHttpError = typeof ServerHttpError.Type;

export const serverHttpErrorStatus = (tag: ServerHttpError["_tag"]): number => statusByTag[tag];

export const globalSearchGroup = HttpApiGroup.make("globalSearch").add(
  HttpApiEndpoint.post("search", "/api/global-search", {
    payload: GlobalProductSearchInput,
    success: GlobalProductSearchResult,
    error: [BadRequest, TooManyRequests, BadGateway],
  }),
);

export const ServerHttpApi = HttpApi.make("ServerHttpApi").add(globalSearchGroup);
