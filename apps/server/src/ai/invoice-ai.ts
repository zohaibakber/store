import type { ConvertedDocument, InvoiceAiClient } from "@store/services";

const INVOICE_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

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
  generate: ({ messages, jsonSchema }) =>
    ai.run(INVOICE_MODEL, {
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      response_format: { type: "json_schema", json_schema: jsonSchema },
      temperature: 0,
      max_tokens: 4096,
    }),
});
