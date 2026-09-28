// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { rememberRecentProduct, useRecentProducts } from "../../src/hooks/use-recent-products";

const product = (id: string, name: string) => ({
  id,
  name,
  strength: "500mg",
  category: { name: "Tablet" },
});

describe("recent products", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the most recent product first without duplicates", () => {
    const { result } = renderHook(() => useRecentProducts());
    act(() => {
      rememberRecentProduct(product("a", "Panadol"));
      rememberRecentProduct(product("b", "Brufen"));
      rememberRecentProduct(product("a", "Panadol"));
    });
    expect(result.current.map((recent) => recent.id)).toEqual(["a", "b"]);
    expect(result.current[0]).toEqual({
      id: "a",
      name: "Panadol",
      strength: "500mg",
      categoryName: "Tablet",
    });
  });

  it("caps the list at eight products", () => {
    const { result } = renderHook(() => useRecentProducts());
    act(() => {
      for (let index = 0; index < 10; index += 1) {
        rememberRecentProduct(product(String(index), `Product ${index}`));
      }
    });
    expect(result.current).toHaveLength(8);
    expect(result.current[0]?.id).toBe("9");
  });

  it("ignores corrupt storage", () => {
    localStorage.setItem("store.recent-products", "{not json");
    const { result } = renderHook(() => useRecentProducts());
    expect(result.current).toEqual([]);
  });
});
