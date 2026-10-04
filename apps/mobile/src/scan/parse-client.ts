import { honourRetryAfter, isAuthStatus } from "@store/contracts/http-errors";
import {
  ServerHttpApi,
  serverHttpErrorStatus,
  type BadGateway,
  type BadRequest,
  type PayloadTooLarge,
  type TooManyRequests,
} from "@store/contracts/server-api";
import { ProductScanInput } from "@store/contracts/server-api.schema";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

class ScanOffline extends Schema.TaggedError<ScanOffline>()("ScanOffline", {}) {}

class ScanRateLimited extends Schema.TaggedError<ScanRateLimited>()("ScanRateLimited", {
  retryAt: Schema.Finite,
}) {}

class ScanFailed extends Schema.TaggedError<ScanFailed>()("ScanFailed", {
  message: Schema.String,
}) {}

class ScanRejected extends Schema.TaggedError<ScanRejected>()("ScanRejected", {
  status: Schema.Int,
  message: Schema.String,
}) {}

export type ScanParseError = ScanOffline | ScanRateLimited | ScanFailed | ScanRejected;

const DEFAULT_RETRY_AFTER_MILLIS = 60_000;
const PARSE_TIMEOUT = "25 seconds";

const retryAfterMillis = (header: string | undefined, now: number): number => {
  const trimmed = header?.trim();
  if (!trimmed) return DEFAULT_RETRY_AFTER_MILLIS;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? DEFAULT_RETRY_AFTER_MILLIS : Math.max(0, date - now);
};

const fallbackMessage = (status: number): string => {
  if (isAuthStatus(status)) return "Sign in again to auto-fill scans.";
  if (status === 413) return "Too much text on this label to auto-fill.";
  if (status >= 500) return "Could not turn the label into product fields.";
  return "This scan could not be auto-filled.";
};

const scanFailureFor = (
  status: number,
  retryAfter: string | undefined,
  now: number,
  message: string | null,
): ScanRateLimited | ScanFailed | ScanRejected => {
  if (status === 429)
    return new ScanRateLimited({ retryAt: now + retryAfterMillis(retryAfter, now) });
  const text = message ?? fallbackMessage(status);
  if (status >= 500) return new ScanFailed({ message: text });
  return new ScanRejected({ status, message: text });
};

const UndeclaredErrorBody = Schema.Struct({
  error: Schema.Struct({ message: Schema.String }),
});

const errorMessage = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(UndeclaredErrorBody)(response).pipe(
    Effect.map((body) => body.error.message),
    Effect.orElseSucceed(() => null),
  );

const unreadable = () => new ScanFailed({ message: "The auto-fill answer was unreadable." });

const isSuccessStatus = (status: number) => status >= 200 && status < 300;

type ParseFailure =
  | BadRequest
  | PayloadTooLarge
  | TooManyRequests
  | BadGateway
  | HttpClientError.HttpClientError
  | Schema.SchemaError;

const scanFailure = Effect.fnUntraced(function* (failure: ParseFailure) {
  if (failure instanceof Schema.SchemaError) return unreadable();
  const now = yield* Clock.currentTimeMillis;
  if (!HttpClientError.isHttpClientError(failure)) {
    return scanFailureFor(
      serverHttpErrorStatus(failure._tag),
      undefined,
      now,
      failure.error.message,
    );
  }
  const response = failure.response;
  if (response === undefined) return new ScanOffline();
  if (isSuccessStatus(response.status)) return unreadable();
  return scanFailureFor(
    response.status,
    Option.getOrUndefined(Headers.get(response.headers, "retry-after")),
    now,
    response.status === 429 ? null : yield* errorMessage(response),
  );
});

const validateInput = Schema.encodeEffect(ProductScanInput);

export const parseProductScan = Effect.fn("ProductScan.parse")(
  function* (baseUrl: string, input: ProductScanInput) {
    yield* validateInput(input).pipe(
      Effect.mapError(
        () => new ScanRejected({ status: 400, message: "This scan has no text to auto-fill." }),
      ),
    );
    const parse = yield* HttpApiClient.endpoint(ServerHttpApi, {
      group: "productScans",
      endpoint: "parse",
      httpClient: yield* HttpClient.HttpClient,
      transformClient: honourRetryAfter,
      baseUrl,
    });
    return yield* parse({ payload: input }).pipe(
      Effect.catch((failure) => Effect.flatMap(scanFailure(failure), Effect.fail)),
    );
  },
  Effect.timeoutOrElse({
    duration: PARSE_TIMEOUT,
    orElse: () => Effect.fail(new ScanFailed({ message: "Auto-fill took too long." })),
  }),
);
