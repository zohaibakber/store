import {
  ImportCatalogRequest,
  ImportCatalogResult,
  ImportPartReceipt,
  ImportStatus,
} from "@store/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import { RequestDeadline } from "./pinned-http";

export class ImportRefused extends Schema.TaggedError<ImportRefused>()("ImportRefused", {
  code: Schema.String,
  message: Schema.String,
}) {}

export class ImportUnavailable extends Schema.TaggedError<ImportUnavailable>()(
  "ImportUnavailable",
  { message: Schema.String },
) {}

export type ImportFailure = ImportRefused | ImportUnavailable;

type ImportAnswer = { readonly status: number; readonly bodyText: string };

export type ImportClient = {
  readonly stagePart: (
    importId: string,
    partNumber: number,
    bodyText: string,
  ) => Effect.Effect<ImportPartReceipt, ImportFailure>;
  readonly commit: (
    importId: string,
    request: ImportCatalogRequest,
  ) => Effect.Effect<ImportCatalogResult, ImportFailure>;
  readonly status: (importId: string) => Effect.Effect<ImportStatus, ImportFailure>;
};

const PART_DEADLINE = Duration.seconds(60);

const COMMIT_DEADLINE = Duration.seconds(120);

const STATUS_DEADLINE = Duration.seconds(30);

const RETRIES = 2;

const decodeHttpErrorBody = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      error: Schema.Struct({
        code: Schema.String,
        message: Schema.String,
      }),
    }),
  ),
);

const encodeCommit = Schema.encodeSync(Schema.fromJsonString(ImportCatalogRequest));

const unreachable = () =>
  new ImportUnavailable({
    message: "Tabaaq could not reach the server. Check the connection and try again.",
  });

const unanswerable = () =>
  new ImportRefused({
    code: "STATUS_UNSUPPORTED",
    message: "The server cannot say yet whether this move finished. Try again later.",
  });

const answersLater = (status: number) =>
  status === 401 || status === 408 || status === 429 || status < 400 || status >= 500;

const failureOf = (response: ImportAnswer): ImportFailure => {
  if (answersLater(response.status)) return unreachable();
  return Option.match(decodeHttpErrorBody(response.bodyText), {
    onNone: () =>
      new ImportRefused({
        code: "REFUSED",
        message: `The server refused the request (${response.status}).`,
      }),
    onSome: (body) => new ImportRefused(body.error),
  });
};

const whenReachable = <A>(effect: Effect.Effect<A, ImportFailure>) =>
  Effect.retry(effect, {
    schedule: Schedule.jittered(Schedule.exponential("500 millis", 2)),
    times: RETRIES,
    while: (failure) => failure._tag === "ImportUnavailable",
  });

const decodePartReceipt = Schema.decodeUnknownEffect(Schema.fromJsonString(ImportPartReceipt));

const decodeCatalogResult = Schema.decodeUnknownEffect(Schema.fromJsonString(ImportCatalogResult));

const decodeStatus = Schema.decodeUnknownEffect(Schema.fromJsonString(ImportStatus));

const statusFailureOf = (response: ImportAnswer): ImportFailure =>
  response.status === 404 ? unanswerable() : failureOf(response);

const importPath = (importId: string) => `/api/sync/imports/${encodeURIComponent(importId)}`;

const isSuccess = (status: number) => status >= 200 && status < 300;

export const makeImportClient = (
  client: HttpClient.HttpClient,
  apiBaseUrl: string,
): ImportClient => {
  const apiOrigin = new URL(apiBaseUrl).origin;
  const send = <A>(
    request: HttpClientRequest.HttpClientRequest,
    deadline: Duration.Duration,
    decode: (bodyText: string) => Effect.Effect<A, Schema.SchemaError>,
    refusal: (answer: ImportAnswer) => ImportFailure = failureOf,
  ): Effect.Effect<A, ImportFailure> =>
    client.execute(request).pipe(
      Effect.flatMap((response) =>
        Effect.map(response.text, (bodyText) => ({ status: response.status, bodyText })),
      ),
      Effect.provideService(RequestDeadline, deadline),
      Effect.timeoutOrElse({ duration: deadline, orElse: () => Effect.fail(unreachable()) }),
      Effect.mapError(unreachable),
      Effect.flatMap((answer) =>
        isSuccess(answer.status)
          ? Effect.mapError(decode(answer.bodyText), unreachable)
          : Effect.fail(refusal(answer)),
      ),
      whenReachable,
    );
  const post = (pathname: string, bodyText: string) =>
    HttpClientRequest.post(`${apiOrigin}${pathname}`).pipe(
      HttpClientRequest.bodyText(bodyText, "application/json"),
    );
  return {
    stagePart: (importId, partNumber, bodyText) =>
      send(
        post(`${importPath(importId)}/parts/${partNumber}`, bodyText),
        PART_DEADLINE,
        decodePartReceipt,
      ),
    commit: (importId, request) =>
      send(
        post(`${importPath(importId)}/commit`, encodeCommit(request)),
        COMMIT_DEADLINE,
        decodeCatalogResult,
      ),
    status: (importId) =>
      send(
        HttpClientRequest.get(`${apiOrigin}${importPath(importId)}`),
        STATUS_DEADLINE,
        decodeStatus,
        statusFailureOf,
      ),
  };
};
