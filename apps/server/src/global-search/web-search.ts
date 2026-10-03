import { WebSearch, WebSearchError } from "@store/services";
import type { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import type { AiGatewayClient } from "../ai/language-model";

const PROVIDER = "ceramic";
const MAX_ERROR_BODY_CHARS = 500;
const SEARCH_TIMEOUT = "12 seconds";

const optionalText = Schema.optional(Schema.NullOr(Schema.String));

const WebSearchResponse = Schema.fromJsonString(
  Schema.Struct({
    items: Schema.Array(
      Schema.Struct({ url: Schema.String, title: optionalText, description: optionalText }),
    ),
  }),
);

const WebSearchRefusal = Schema.fromJsonString(
  Schema.Struct({ error: Schema.Struct({ code: Schema.String }) }),
);

const decodeWebSearchResponse = Schema.decodeUnknownEffect(WebSearchResponse);
const decodeWebSearchRefusal = Schema.decodeUnknownOption(WebSearchRefusal);

const failed = (message: string) => (cause: unknown) =>
  new WebSearchError({
    message: `${message} ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  });

const refused = (status: number, body: string) => {
  const excerpt = body.slice(0, MAX_ERROR_BODY_CHARS);
  return Option.match(decodeWebSearchRefusal(body), {
    onNone: () =>
      new WebSearchError({
        message: `Cloudflare web search answered ${status}: ${excerpt || "an empty body"}`,
        status,
        cause: excerpt,
      }),
    onSome: ({ error }) =>
      new WebSearchError({
        message: `Cloudflare web search answered ${status} with ${error.code}.`,
        status,
        code: error.code,
        cause: excerpt,
      }),
  });
};

export const cloudflareWebSearch = (
  client: AiGatewayClient,
): Layer.Layer<WebSearch, never, RuntimeContext> =>
  Layer.effect(
    WebSearch,
    Effect.gen(function* () {
      const ai = yield* client.raw;
      const gatewayId = yield* client.id;
      return {
        search: Effect.fn("WebSearch.search")(
          function* (query: string, limit: number) {
            if (!Predicate.hasProperty(ai, "websearch")) {
              return yield* new WebSearchError({
                message:
                  "This runtime's AI binding has no websearch method; it needs workerd 1.20260925 or newer.",
              });
            }
            const response = yield* Effect.tryPromise({
              try: () => ai.websearch({ gatewayId, query, limit, provider: PROVIDER }),
              catch: failed("Cloudflare web search did not answer."),
            });
            const body = yield* Effect.tryPromise({
              try: () => response.text(),
              catch: failed("Cloudflare web search sent an unreadable answer."),
            });
            if (!response.ok) return yield* refused(response.status, body);
            const { items } = yield* decodeWebSearchResponse(body).pipe(
              Effect.mapError(failed("Cloudflare web search sent an unexpected answer.")),
            );
            return items.map((item) => ({
              url: item.url,
              title: item.title ?? "",
              description: item.description ?? "",
            }));
          },
          Effect.timeoutOrElse({
            duration: SEARCH_TIMEOUT,
            orElse: () =>
              Effect.fail(
                new WebSearchError({
                  message: `Cloudflare web search did not answer within ${SEARCH_TIMEOUT}.`,
                }),
              ),
          }),
        ),
      };
    }),
  );
