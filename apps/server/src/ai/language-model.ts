import type { RuntimeContext } from "alchemy";
import * as AiError from "effect/ai/AiError";
import * as LanguageModel from "effect/ai/LanguageModel";
import { toCodecOpenAI } from "effect/ai/OpenAiStructuredOutput";
import type * as Prompt from "effect/ai/Prompt";
import type * as Response from "effect/ai/Response";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { MODEL, type JsonSchemaObject } from "./workers-ai";

const MAX_COMPLETION_TOKENS = 1024;

export interface AiGatewayClient {
  readonly raw: Effect.Effect<Ai, never, RuntimeContext>;
  readonly id: Effect.Effect<string, never, RuntimeContext>;
}

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

const responseFormat = (format: LanguageModel.ProviderOptions["responseFormat"]) => {
  if (format.type === "text") return {};
  // SAFETY: Effect's JSON Schema encoder only yields JSON values, the shape Ai.run accepts.
  const schema = toCodecOpenAI(format.schema).jsonSchema as JsonSchemaObject;
  return {
    response_format: {
      type: "json_schema" as const,
      json_schema: { name: format.objectName, schema, strict: true },
    },
  };
};

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

export const workersAiLanguageModel = (
  client: AiGatewayClient,
): Layer.Layer<LanguageModel.LanguageModel, never, RuntimeContext> =>
  Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const ai = yield* client.raw;
      const gatewayId = yield* client.id;
      return yield* LanguageModel.make({
        codecTransformer: toCodecOpenAI,
        generateText: Effect.fn("WorkersAiLanguageModel.generateText")(function* (options) {
          return yield* Effect.tryPromise({
            try: async (signal) => {
              const output = await ai.run(
                MODEL,
                {
                  messages: chatMessages(options.prompt),
                  ...responseFormat(options.responseFormat),
                  chat_template_kwargs: { enable_thinking: false },
                  temperature: 0,
                  max_completion_tokens: MAX_COMPLETION_TOKENS,
                },
                { gateway: { id: gatewayId }, signal },
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
