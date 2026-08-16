import type { ConvertedDocument, InvoiceAiClient } from "@store/services";

const INVOICE_MODEL = "@cf/google/gemma-4-26b-a4b-it";

type JsonSchemaValue = string | number | boolean | null | JsonSchemaObject | JsonSchemaValue[];
interface JsonSchemaObject {
  readonly [key: string]: JsonSchemaValue;
}

export const invoiceAiClient = (ai: Ai): InvoiceAiClient => ({
  toMarkdown: async (documents) => {
    const converted = await ai.toMarkdown(
      documents.map((document) => ({ name: document.name, blob: document.blob })),
    );
    return converted.map(
      (result): ConvertedDocument =>
        result.format === "error"
          ? { name: result.name, error: result.error }
          : { name: result.name, data: result.data },
    );
  },
  generate: async ({ messages, jsonSchema }) => {
    // SAFETY: The schema is produced by Effect's JSON Schema encoder and therefore contains JSON values only.
    const workerJsonSchema = jsonSchema as JsonSchemaObject;
    const output = await ai.run(INVOICE_MODEL, {
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "invoice_extraction",
          schema: workerJsonSchema,
          strict: true,
        },
      },
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0,
      max_completion_tokens: 4096,
    });
    return output.choices[0]?.message.content ?? "";
  },
});
