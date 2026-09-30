import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const ModelScalar = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
]);
export type ModelScalar = typeof ModelScalar.Type;

interface ModelEnvelope {
  readonly response: string;
}

export type ModelOutput<Payload> = string | ModelEnvelope | Payload;

const decodeJsonText = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodePlainObject = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
const isString = Schema.is(Schema.String);
const isEnvelope = Schema.is(Schema.Struct({ response: Schema.String }));

const jsonObject = (text: string) => Option.flatMap(decodeJsonText(text), decodePlainObject);

const jsonObjectText = (candidate: string) => {
  const direct = jsonObject(candidate);
  if (Option.isSome(direct)) return direct;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return Option.none();
  return jsonObject(candidate.slice(start, end + 1));
};

const recoverModelJson = <Payload>(raw: ModelOutput<Payload>) => {
  if (isString(raw)) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    return jsonObjectText((fenced?.[1] ?? raw).trim());
  }
  if (isEnvelope(raw)) return jsonObjectText(raw.response);
  return Option.some(raw);
};

export const decodeModelJson = <S extends Schema.Constraint>(schema: S) => {
  const decode = Schema.decodeUnknownEffect(schema);
  return (raw: ModelOutput<S["Encoded"]>) =>
    Effect.fromOption(
      recoverModelJson(raw),
      () => new Cause.NoSuchElementError("The model did not return JSON."),
    ).pipe(Effect.flatMap(decode));
};
