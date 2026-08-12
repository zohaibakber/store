import type { ConvertedDocument, InvoiceAiClient } from "@store/services";

const INVOICE_MODEL = "@cf/google/gemma-4-26b-a4b-it";

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
    const output = await ai.run(INVOICE_MODEL, {
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "invoice_extraction",
          schema: jsonSchema as Record<string, unknown>,
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
