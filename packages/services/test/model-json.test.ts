import { describe, expect, it } from "vitest";

import { parseModelJson } from "../src/model-json";

describe("parseModelJson", () => {
  it.each<[string, unknown]>([
    ["bare JSON objects", '{"name":"Amox"}'],
    ["fenced markdown", '```json\n{"name":"Amox"}\n```'],
    ["an object surrounded by prose", 'Here you go:\n{"name":"Amox"}\nThanks'],
    ["a nested response string", { response: '{"name":"Amox"}' }],
    ["an already-parsed object", { name: "Amox" }],
  ])("decodes %s", (_name, raw) => {
    expect(parseModelJson(raw)).toEqual({ name: "Amox" });
  });

  it("rejects text without a JSON object", () => {
    expect(() => parseModelJson("not json")).toThrow("The model did not return JSON.");
  });
});
