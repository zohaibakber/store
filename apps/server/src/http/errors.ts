import { publicErrorSchema } from "@store/contracts/http-errors";
import {
  BadGateway,
  BadRequest,
  PayloadTooLarge,
  TooManyRequests,
  UnsupportedMediaType,
} from "@store/contracts/server-api";
import * as Effect from "effect/Effect";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

export const Unauthenticated = publicErrorSchema("Unauthenticated", 401);
export type Unauthenticated = typeof Unauthenticated.Type;

export const Forbidden = publicErrorSchema("Forbidden", 403);
export type Forbidden = typeof Forbidden.Type;

export const publicError = (code: string, message: string) => ({ error: { code, message } });

export const badRequest = (code: string, message: string) =>
  BadRequest.make(publicError(code, message));
export const unauthenticated = (code: string, message: string) =>
  Unauthenticated.make(publicError(code, message));
export const payloadTooLarge = (code: string, message: string) =>
  PayloadTooLarge.make(publicError(code, message));
export const unsupportedMediaType = (code: string, message: string) =>
  UnsupportedMediaType.make(publicError(code, message));
export const tooManyRequests = (code: string, message: string) =>
  TooManyRequests.make(publicError(code, message));
export const badGateway = (code: string, message: string) =>
  BadGateway.make(publicError(code, message));

const retryAfterWholeSeconds = (delayMillis: number) => Math.max(1, Math.ceil(delayMillis / 1_000));

export const retryAfter = (delayMillis: number) =>
  HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.succeed(
      HttpServerResponse.setHeader(
        response,
        "retry-after",
        String(retryAfterWholeSeconds(delayMillis)),
      ),
    ),
  );
