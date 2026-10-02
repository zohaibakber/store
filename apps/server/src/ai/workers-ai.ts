import {
  ModelRequestError,
  type ConvertedDocument,
  type InvoiceAiClient,
  type ModelPrompt,
  type ProductScanAiClient,
} from "@store/services";
import * as Effect from "effect/Effect";

const MODEL = "@cf/google/gemma-4-26b-a4b-it";

type JsonSchemaValue = string | number | boolean | null | JsonSchemaObject | JsonSchemaValue[];
interface JsonSchemaObject {
  readonly [key: string]: JsonSchemaValue;
}

const generateJson =
  (ai: Ai, name: string, maxCompletionTokens: number) =>
  ({ messages, jsonSchema }: ModelPrompt) => {
    // SAFETY: Effect's JSON Schema encoder only yields JSON values, the shape Ai.run accepts.
    const schema = jsonSchema as JsonSchemaObject;
    return Effect.tryPromise({
      try: async (signal) => {
        const output = await ai.run(
          MODEL,
          {
            messages: messages.map((message) => ({ role: message.role, content: message.content })),
            response_format: {
              type: "json_schema",
              json_schema: { name, schema, strict: true },
            },
            chat_template_kwargs: { enable_thinking: false },
            temperature: 0,
            max_completion_tokens: maxCompletionTokens,
          },
          { signal },
        );
        return output.choices[0]?.message.content ?? "";
      },
      catch: (cause) =>
        new ModelRequestError({ message: `Workers AI did not answer the ${name} prompt.`, cause }),
    });
  };

export const invoiceAiClient = (ai: Ai): InvoiceAiClient => ({
  toMarkdown: (documents) =>
    Effect.tryPromise({
      try: async () => {
        const converted = await ai.toMarkdown(
          documents.map((document) => ({ name: document.name, blob: document.blob })),
        );
        return converted.map((result): ConvertedDocument =>
          result.format === "error"
            ? { kind: "error", name: result.name, error: result.error }
            : { kind: "ok", name: result.name, data: result.data },
        );
      },
      catch: (cause) =>
        new ModelRequestError({ message: "Workers AI did not convert the attachments.", cause }),
    }),
  generate: generateJson(ai, "invoice_extraction", 4096),
});

export const productScanAiClient = (ai: Ai): ProductScanAiClient => ({
  generate: generateJson(ai, "product_scan", 512),
});
