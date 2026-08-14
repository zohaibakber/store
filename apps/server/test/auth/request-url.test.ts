import { describe, expect, it } from "vitest";

import { absoluteAuthRequest } from "../../src/auth/request-url";

describe("absoluteAuthRequest", () => {
  it("leaves an absolute request unchanged", () => {
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
});
