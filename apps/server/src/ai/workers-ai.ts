export const MODEL = "@cf/google/gemma-4-26b-a4b-it";

type JsonSchemaValue = string | number | boolean | null | JsonSchemaObject | JsonSchemaValue[];
interface JsonSchemaObject {
  readonly [key: string]: JsonSchemaValue;
}

interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

interface JsonCompletion {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly maxCompletionTokens: number;
  readonly format?: { readonly name: string; readonly jsonSchema: object };
}

const responseFormat = (format: JsonCompletion["format"]) => {
  if (format === undefined) return {};
  // SAFETY: Effect's JSON Schema encoder only yields JSON values, the shape Ai.run accepts.
  const schema = format.jsonSchema as JsonSchemaObject;
  return {
    response_format: {
      type: "json_schema" as const,
      json_schema: { name: format.name, schema, strict: true },
    },
  };
};

export const runJsonCompletion = (
  ai: Ai,
  { messages, maxCompletionTokens, format }: JsonCompletion,
  options: { readonly signal: AbortSignal; readonly gatewayId?: string },
) =>
  ai.run(
    MODEL,
    {
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      ...responseFormat(format),
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0,
      max_completion_tokens: maxCompletionTokens,
    },
    options.gatewayId === undefined
      ? { signal: options.signal }
      : { gateway: { id: options.gatewayId }, signal: options.signal },
  );
