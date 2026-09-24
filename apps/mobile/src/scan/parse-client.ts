import { ProductScanInput, ProductScanResult } from "@store/contracts/server-api.schema";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

export class ScanOffline extends Schema.TaggedError<ScanOffline>()("ScanOffline", {}) {}

export class ScanRateLimited extends Schema.TaggedError<ScanRateLimited>()("ScanRateLimited", {
  retryAt: Schema.Finite,
}) {}

export class ScanFailed extends Schema.TaggedError<ScanFailed>()("ScanFailed", {
  message: Schema.String,
}) {}

export class ScanRejected extends Schema.TaggedError<ScanRejected>()("ScanRejected", {
  status: Schema.Int,
  message: Schema.String,
}) {}

export type ScanParseError = ScanOffline | ScanRateLimited | ScanFailed | ScanRejected;

export const DEFAULT_RETRY_AFTER_MILLIS = 60_000;
const PARSE_TIMEOUT = "25 seconds";

export const retryAfterMillis = (header: string | undefined, now: number): number => {
  const trimmed = header?.trim();
  if (!trimmed) return DEFAULT_RETRY_AFTER_MILLIS;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? DEFAULT_RETRY_AFTER_MILLIS : Math.max(0, date - now);
};

const fallbackMessage = (status: number): string => {
  if (status === 401 || status === 403) return "Sign in again to auto-fill scans.";
  if (status === 413) return "Too much text on this label to auto-fill.";
  if (status >= 500) return "Could not turn the label into product fields.";
  return "This scan could not be auto-filled.";
};

export const scanFailureFor = (
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

const PublicErrorBody = Schema.Struct({
  error: Schema.Struct({ code: Schema.String, message: Schema.String }),
});

const errorMessage = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(PublicErrorBody)(response).pipe(
    Effect.map((body) => body.error.message),
    Effect.orElseSucceed(() => null),
  );

export const productScanUrl = (baseUrl: string): string =>
  new URL("/api/product-scans", baseUrl).toString();

export const parseProductScan = Effect.fn("ProductScan.parse")(
  function* (baseUrl: string, input: ProductScanInput) {
    const client = yield* HttpClient.HttpClient;
    const request = yield* HttpClientRequest.post(productScanUrl(baseUrl)).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.schemaBodyJson(ProductScanInput)(input),
      Effect.mapError(
        () => new ScanRejected({ status: 400, message: "This scan has no text to auto-fill." }),
      ),
    );
    const response = yield* client.execute(request).pipe(Effect.mapError(() => new ScanOffline()));
    if (response.status < 200 || response.status >= 300) {
      const now = yield* Clock.currentTimeMillis;
      const message = response.status === 429 ? null : yield* errorMessage(response);
      return yield* Effect.fail(
        scanFailureFor(
          response.status,
          Option.getOrUndefined(Headers.get(response.headers, "retry-after")),
          now,
          message,
        ),
      );
    }
    return yield* HttpClientResponse.schemaBodyJson(ProductScanResult)(response).pipe(
      Effect.mapError(() => new ScanFailed({ message: "The auto-fill answer was unreadable." })),
    );
  },
  Effect.timeoutOrElse({
    duration: PARSE_TIMEOUT,
    orElse: () => Effect.fail(new ScanFailed({ message: "Auto-fill took too long." })),
  }),
);
