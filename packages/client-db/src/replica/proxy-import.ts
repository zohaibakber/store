import { ImportCatalogRequest, ImportCatalogResult, ImportPartReceipt } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import {
  decodeHttpErrorBody,
  type SyncProxyRequest,
  type SyncProxyResponse,
} from "./proxy-transport";

export class ImportRefused extends Schema.TaggedError<ImportRefused>()("ImportRefused", {
  code: Schema.String,
  message: Schema.String,
}) {}

export class ImportUnavailable extends Schema.TaggedError<ImportUnavailable>()(
  "ImportUnavailable",
  { message: Schema.String },
) {}

export type ImportFailure = ImportRefused | ImportUnavailable;

type ImportProxyFetch = (request: SyncProxyRequest) => Effect.Effect<SyncProxyResponse>;

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
};

const PART_TIMEOUT_MILLIS = 60_000;

const COMMIT_TIMEOUT_MILLIS = 120_000;

const RETRIES = 2;

const encodeCommit = Schema.encodeSync(Schema.fromJsonString(ImportCatalogRequest));

const unreachable = () =>
  new ImportUnavailable({
    message: "Tabaaq could not reach the server. Check the connection and try again.",
  });

const answersLater = (status: number) =>
  status === 401 || status === 408 || status === 429 || status < 400 || status >= 500;

const failureOf = (response: SyncProxyResponse): ImportFailure => {
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

export const makeProxyImportClient = (proxyFetch: ImportProxyFetch): ImportClient => {
  const post = <A, I>(
    schema: Schema.Codec<A, I>,
    pathname: string,
    bodyText: string,
    timeoutMillis: number,
  ): Effect.Effect<A, ImportFailure> =>
    proxyFetch({ method: "POST", pathname, bodyText, timeoutMillis }).pipe(
      Effect.flatMap((response): Effect.Effect<A, ImportFailure> =>
        response.ok
          ? Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(response.bodyText).pipe(
              Effect.mapError(unreachable),
            )
          : Effect.fail(failureOf(response)),
      ),
      whenReachable,
    );
  const importPath = (importId: string) => `/api/sync/imports/${encodeURIComponent(importId)}`;
  return {
    stagePart: (importId, partNumber, bodyText) =>
      post(
        ImportPartReceipt,
        `${importPath(importId)}/parts/${partNumber}`,
        bodyText,
        PART_TIMEOUT_MILLIS,
      ),
    commit: (importId, request) =>
      post(
        ImportCatalogResult,
        `${importPath(importId)}/commit`,
        encodeCommit(request),
        COMMIT_TIMEOUT_MILLIS,
      ),
  };
};
