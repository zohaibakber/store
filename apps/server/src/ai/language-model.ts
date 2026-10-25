import * as AiError from "effect/ai/AiError";
import * as LanguageModel from "effect/ai/LanguageModel";
import { toCodecOpenAI } from "effect/ai/OpenAiStructuredOutput";
import type * as Prompt from "effect/ai/Prompt";
import type * as Response from "effect/ai/Response";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { AiGateway } from "./gateway";
import { runJsonCompletion } from "./workers-ai";

const MAX_COMPLETION_TOKENS = 1024;

const aiError = (method: string, description: string) =>
  AiError.make({
    module: "WorkersAiLanguageModel",
    method,
    reason: new AiError.UnknownError({ description }),
  });

const partsText = (parts: ReadonlyArray<{ readonly type: string; readonly text?: string }>) =>
  parts
    .flatMap((part) => (part.type === "text" && part.text !== undefined ? [part.text] : []))
    .join("\n");

const chatMessages = (prompt: Prompt.Prompt) =>
  prompt.content.flatMap(
    (message): ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }> => {
      switch (message.role) {
        case "system":
          return [{ role: "system", content: message.content }];
        case "user":
          return [{ role: "user", content: partsText(message.content) }];
        case "assistant":
          return [{ role: "assistant", content: partsText(message.content) }];
        case "tool":
          return [];
      }
    },
  );

const responseFormat = (format: LanguageModel.ProviderOptions["responseFormat"]) =>
  format.type === "text"
    ? undefined
    : { name: format.objectName, jsonSchema: toCodecOpenAI(format.schema).jsonSchema };

const finishReason = (reason: string | null | undefined): Response.FinishReason => {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "content-filter";
    case undefined:
    case null:
      return "unknown";
    default:
      return "other";
  }
};

export const workersAiLanguageModel: Layer.Layer<LanguageModel.LanguageModel, never, AiGateway> =
  Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const gateway = yield* AiGateway;
      return yield* LanguageModel.make({
        codecTransformer: toCodecOpenAI,
        generateText: Effect.fn("WorkersAiLanguageModel.generateText")(function* (options) {
          const ai = yield* gateway.raw;
          const gatewayId = yield* gateway.id;
          return yield* Effect.tryPromise({
            try: async (signal) => {
              const output = await runJsonCompletion(
                ai,
                {
                  messages: chatMessages(options.prompt),
                  maxCompletionTokens: MAX_COMPLETION_TOKENS,
                  format: responseFormat(options.responseFormat),
                },
                { signal, gatewayId },
              );
              const choice = output.choices[0];
              const text = choice?.message.content ?? "";
              const parts: Array<Response.PartEncoded> = [];
              if (text) parts.push({ type: "text", text });
              parts.push({
                type: "finish",
                reason: finishReason(choice?.finish_reason),
                usage: {
                  inputTokens: { total: output.usage?.prompt_tokens },
                  outputTokens: { total: output.usage?.completion_tokens },
                },
              });
              return parts;
            },
            catch: (cause) =>
              aiError(
                "generateText",
                cause instanceof Error ? cause.message : "Workers AI did not answer.",
              ),
          });
        }),
        streamText: () =>
          Stream.fail(aiError("streamText", "Streaming is not supported by this model binding.")),
      });
    }),
  );
