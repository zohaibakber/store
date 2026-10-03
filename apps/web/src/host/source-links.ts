import type { GlobalProductSearchResult } from "@store/contracts/server-api.schema";

const MAX_SOURCE_LINKS = 512;

export type SourceLinks = {
  readonly remember: (result: GlobalProductSearchResult) => void;
  readonly allows: (url: string) => boolean;
};

const isPlainHttpsUrl = (value: string) => {
  const url = URL.parse(value);
  return url !== null && url.protocol === "https:" && url.username === "" && url.password === "";
};

export const makeSourceLinks = (): SourceLinks => {
  const links = new Set<string>();
  return {
    remember: (result) => {
      for (const product of result.products) {
        if (!isPlainHttpsUrl(product.sourceUrl)) continue;
        links.delete(product.sourceUrl);
        links.add(product.sourceUrl);
      }
      for (const oldest of links) {
        if (links.size <= MAX_SOURCE_LINKS) break;
        links.delete(oldest);
      }
    },
    allows: (url) => links.has(url),
  };
};
