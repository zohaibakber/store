import { decodeProductId } from "@store/contracts/ids";
import { describe, expect, it } from "vitest";

import { importProductMatch } from "@/components/uploads/same-product";

describe("importProductMatch", () => {
  const ten = {
    id: decodeProductId("11111111-1111-4111-8111-111111111111"),
    name: "Amoxicillin",
    unitsPerPack: 10,
  };
  const twenty = {
    id: decodeProductId("22222222-2222-4222-8222-222222222222"),
    name: "Amoxicillin",
    unitsPerPack: 20,
  };
  const duplicateTwenty = {
    id: decodeProductId("33333333-3333-4333-8333-333333333333"),
    name: " amoxicillin ",
    unitsPerPack: 20,
  };

  it("binds a line only to the single catalog product with the same name and pack size", () => {
    const line = { name: "Amoxicillin", unitsPerPack: 20 };
    expect(importProductMatch(line, [ten, twenty])).toEqual({ _tag: "one", id: twenty.id });
    expect(importProductMatch({ name: "Ibuprofen", unitsPerPack: 10 }, [ten, twenty])).toEqual({
      _tag: "none",
    });
    expect(importProductMatch(line, [ten, twenty, duplicateTwenty])).toEqual({ _tag: "many" });
  });
});
