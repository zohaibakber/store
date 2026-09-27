import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodeJsonText = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodePlainObject = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
const isString = Schema.is(Schema.String);

const isEnvelope = Schema.is(Schema.Struct({ response: Schema.String }));

const parseJsonObjectText = (candidate: string) => {
  const asObject = (text: string) => {
    const parsed = decodeJsonText(text);
    if (Option.isNone(parsed)) return Option.none();
    return decodePlainObject(parsed.value);
  };
  const direct = asObject(candidate);
  if (Option.isSome(direct)) return direct.value;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The model did not return JSON.");
  const sliced = asObject(candidate.slice(start, end + 1));
  if (Option.isNone(sliced)) throw new Error("The model did not return JSON.");
  return sliced.value;
};

export const parseModelJson = <Payload>(raw: string | Payload): Payload => {
  if (isString(raw)) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = (fenced?.[1] ?? raw).trim();
    // SAFETY: Callers name Payload for the Schema decode that follows; this recovers a plain object.
    return parseJsonObjectText(candidate) as Payload;
  }
  if (!isEnvelope(raw)) return raw;
  // SAFETY: Callers name Payload for the Schema decode that follows; this recovers a plain object.
  return parseJsonObjectText(raw.response) as Payload;
};
