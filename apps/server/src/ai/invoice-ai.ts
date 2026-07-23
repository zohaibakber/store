import type { ConvertedDocument, InvoiceAiClient } from "@store/services";

/**
 * Llama 4 Scout is the Workers AI text model that supports `response_format`
 * with a JSON schema, which is what constrains extraction output. Model choice
 * lives here rather than in `@store/services` because only this package has the
 * binding types that validate the name.
 */
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
