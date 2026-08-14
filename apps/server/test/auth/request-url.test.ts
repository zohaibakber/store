import { describe, expect, it } from "vitest";

import {
  absoluteAuthRequest,
  isAbsoluteHttpUrl,
  isWebRequest,
  webRequestForAuth,
} from "../../src/auth/request-url";

describe("absoluteAuthRequest", () => {
  it("leaves an absolute http(s) request unchanged", () => {
    const request = new Request("https://tabaaq.zohaibakber.com/api/auth/ok");
    expect(absoluteAuthRequest(request, "https://tabaaq.zohaibakber.com")).toBe(request);
  });

  it("rebuilds a relative URL against the public origin", () => {
    const relative = {
      url: "/api/auth/sign-in/email",
      method: "POST",
      headers: new Headers({ origin: "https://tabaaq.zohaibakber.com" }),
    } as Request;

    const absolute = absoluteAuthRequest(relative, "https://tabaaq.zohaibakber.com");

    expect(absolute).not.toBe(relative);
    expect(absolute.url).toBe("https://tabaaq.zohaibakber.com/api/auth/sign-in/email");
    expect(absolute.method).toBe("POST");
    expect(absolute.headers.get("origin")).toBe("https://tabaaq.zohaibakber.com");
  });

  it("treats Effect HTTP path-only URLs as relative", () => {
    expect(isAbsoluteHttpUrl("/api/auth/ok")).toBe(false);
    expect(isAbsoluteHttpUrl("https://tabaaq.zohaibakber.com/api/auth/ok")).toBe(true);
  });
});

describe("webRequestForAuth", () => {
  it("prefers the Cloudflare Request service over Effect's path-only url", () => {
    const raw = new Request("https://tabaaq.zohaibakber.com/api/auth/ok");
    const request = { url: "/api/auth/ok", originalUrl: "/api/auth/ok", source: {} };
    expect(webRequestForAuth(request, raw, "https://tabaaq.zohaibakber.com")).toBe(raw);
  });

  it("uses HttpServerRequest.source when it is a Request, without instanceof", () => {
    const source = new Request("https://tabaaq-api.workers.dev/api/auth/ok");
    expect(isWebRequest(source)).toBe(true);
    const rebuilt = webRequestForAuth(
      { url: "/api/auth/ok", originalUrl: source.url, source },
      undefined,
      "https://tabaaq.zohaibakber.com",
    );
    expect(rebuilt).toBe(source);
  });

  it("rebuilds against the public origin when no raw Request is present", () => {
    const rebuilt = webRequestForAuth(
      { url: "/api/auth/ok", originalUrl: "/api/auth/ok", source: {} },
      undefined,
      "https://tabaaq.zohaibakber.com",
    );
    expect(rebuilt.url).toBe("https://tabaaq.zohaibakber.com/api/auth/ok");
  });
});
