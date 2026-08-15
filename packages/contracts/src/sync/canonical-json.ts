export const compareCodeUnits = (left: string, right: string) => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

const isJsonObject = (value: JsonValue): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const canonicalizeJson = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, nested]) => [key, canonicalizeJson(nested)]),
  );
};

export const canonicalJson = <Value>(value: Value) => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return undefined;
  const jsonValue: JsonValue = JSON.parse(serialized);
  return JSON.stringify(canonicalizeJson(jsonValue));
};
