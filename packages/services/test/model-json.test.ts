import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { decodeModelJson, type ModelOutput } from "../src/model-json";

const decodeName = decodeModelJson(Schema.Struct({ name: Schema.String }));

describe("decodeModelJson", () => {
  it.each<[string, ModelOutput<{ readonly name: string }>]>([
    ["bare JSON objects", '{"name":"Amox"}'],
    ["fenced markdown", '```json\n{"name":"Amox"}\n```'],
    ["an object surrounded by prose", 'Here you go:\n{"name":"Amox"}\nThanks'],
    ["a nested response string", { response: '{"name":"Amox"}' }],
    ["an already-parsed object", { name: "Amox" }],
  ])("decodes %s", async (_name, raw) => {
    expect(await Effect.runPromise(decodeName(raw))).toEqual({ name: "Amox" });
  });

  it.each<[string, ModelOutput<{ readonly name: string }>]>([
    ["text without a JSON object", "not json"],
    ["an object of the wrong shape", '{"name":null}'],
  ])("fails typed for %s", async (_name, raw) => {
    const exit = await Effect.runPromiseExit(decodeName(raw));
    expect(Exit.isFailure(exit) && !Exit.hasDies(exit)).toBe(true);
  });
});
