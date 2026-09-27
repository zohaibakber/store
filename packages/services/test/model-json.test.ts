import { describe, expect, it } from "vitest";

import { parseModelJson } from "../src/model-json";

describe("parseModelJson", () => {
  it("decodes bare JSON objects", () => {
    expect(parseModelJson<{ readonly name?: string }>('{"name":"Amox"}')).toEqual({
      name: "Amox",
    });
  });

  it("strips fenced markdown before decoding", () => {
    expect(parseModelJson<{ readonly name?: string }>('```json\n{"name":"Amox"}\n```')).toEqual({
      name: "Amox",
    });
  });

  it("salvages a JSON object from surrounding prose", () => {
    expect(
      parseModelJson<{ readonly name?: string }>('Here you go:\n{"name":"Amox"}\nThanks'),
    ).toEqual({ name: "Amox" });
  });

  it("passes through already-parsed objects", () => {
    const value = { name: "Amox" };
    expect(parseModelJson(value)).toBe(value);
  });

  it("unwraps a nested response string", () => {
    expect(
      parseModelJson<{ readonly response?: string; readonly name?: string }>({
        response: '{"name":"Amox"}',
      }),
    ).toEqual({ name: "Amox" });
  });

  it("rejects text without a JSON object", () => {
    expect(() => parseModelJson("not json")).toThrow("The model did not return JSON.");
  });
});
