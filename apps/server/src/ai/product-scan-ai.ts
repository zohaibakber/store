import type { ProductScanAiClient } from "@store/services";

const PRODUCT_SCAN_MODEL = "@cf/google/gemma-4-26b-a4b-it";

type JsonSchemaValue = string | number | boolean | null | JsonSchemaObject | JsonSchemaValue[];
interface JsonSchemaObject {
  readonly [key: string]: JsonSchemaValue;
}

export const productScanAiClient = (ai: Ai, requestSignal?: AbortSignal): ProductScanAiClient => ({
  generate: async ({ messages, jsonSchema, signal }) => {
    // SAFETY: The schema is produced by Effect's JSON Schema encoder and therefore contains JSON values only.
    const workerJsonSchema = jsonSchema as JsonSchemaObject;
    const output = await ai.run(
      PRODUCT_SCAN_MODEL,
      {
        messages: messages.map((message) => ({ role: message.role, content: message.content })),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "product_scan",
            schema: workerJsonSchema,
            strict: true,
          },
        },
        chat_template_kwargs: { enable_thinking: false },
        temperature: 0,
        max_completion_tokens: 512,
      },
      {
        signal: requestSignal ? AbortSignal.any([requestSignal, signal]) : signal,
      },
    );
    return output.choices[0]?.message.content ?? "";
  },
});
