// @vitest-environment happy-dom
import { RegistryContext } from "@effect/atom-react";
import { act, renderHook } from "@testing-library/react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { useRecentProducts, useRememberRecentProduct } from "../../src/hooks/use-recent-products";

const product = (id: string, name: string) => ({
  id,
  name,
  strength: "500mg",
  category: { name: "Tablet" },
});

const useRecents = () => ({ recents: useRecentProducts(), remember: useRememberRecentProduct() });

const renderRecents = () => {
  const registry = AtomRegistry.make();
  return renderHook(useRecents, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
    ),
  });
};

describe("recent products", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the most recent product first without duplicates", () => {
    const { result } = renderRecents();
    act(() => result.current.remember(product("a", "Panadol")));
    act(() => result.current.remember(product("b", "Brufen")));
    act(() => result.current.remember(product("a", "Panadol")));
    expect(result.current.recents.map((recent) => recent.id)).toEqual(["a", "b"]);
    expect(result.current.recents[0]).toEqual({
      id: "a",
      name: "Panadol",
      strength: "500mg",
      categoryName: "Tablet",
    });
  });

  it("caps the list at eight products", () => {
    const { result } = renderRecents();
    for (let index = 0; index < 10; index += 1) {
      act(() => result.current.remember(product(String(index), `Product ${index}`)));
    }
    expect(result.current.recents).toHaveLength(8);
    expect(result.current.recents[0]?.id).toBe("9");
  });

  it("ignores corrupt storage", () => {
    localStorage.setItem("store.recent-products", "{not json");
    const { result } = renderRecents();
    expect(result.current.recents).toEqual([]);
  });
});
