import { MAX_PAGE_HEAD_CHARS, PageImages, pageImageFromHead } from "@store/services";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "user-agent": "Mozilla/5.0 (compatible; TabaaqBot/1.0)",
};
const HEAD_END = "</head>";

interface PageHead {
  readonly html: string;
  readonly complete: boolean;
}

const appendChunk = (head: PageHead, chunk: string): PageHead => {
  const html = head.html + chunk;
  const searchFrom = Math.max(0, head.html.length - HEAD_END.length + 1);
  return {
    html,
    complete: html.length >= MAX_PAGE_HEAD_CHARS || html.includes(HEAD_END, searchFrom),
  };
};

export const PageImagesLive: Layer.Layer<PageImages> = Layer.effect(
  PageImages,
  Effect.gen(function* () {
    const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
    return {
      find: Effect.fn("PageImages.find")(
        function* (url: string) {
          const response = yield* client.get(url, { headers: REQUEST_HEADERS });
          const head = yield* response.stream.pipe(
            Stream.decodeText(),
            Stream.scan((): PageHead => ({ html: "", complete: false }), appendChunk),
            Stream.takeUntil((state) => state.complete),
            Stream.runLast,
          );
          return Option.match(head, {
            onNone: () => null,
            onSome: ({ html }) => pageImageFromHead(html, url),
          });
        },
        Effect.timeout("2500 millis"),
        Effect.orElseSucceed(() => null),
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      ),
    };
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
