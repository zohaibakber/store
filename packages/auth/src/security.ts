import * as Result from "effect/Result";

export const ELECTRON_PROTOCOL = "com.tabaaq.desktop";
export const ELECTRON_RENDERER_HOST = "app";

export const isDesktopRedirect = (redirectUri: string) =>
  Result.match(Result.try({ try: () => new URL(redirectUri), catch: () => "is not a URL" }), {
    onFailure: () => false,
    onSuccess: (url) => url.protocol === `${ELECTRON_PROTOCOL}:`,
  });
