import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { describe, expect, it } from "vitest";

import { googleOAuthAppResponse, oauthCallbackErrorResponse } from "../src/oauth-callback-page";

const bodyText = (response: HttpServerResponse.HttpServerResponse) => {
  if (!HttpBody.isHttpBody(response.body) || response.body._tag !== "Uint8Array") {
    throw new Error(`unexpected body ${response.body._tag}`);
  }
  return new TextDecoder().decode(response.body.body);
};

describe("googleOAuthAppResponse", () => {
  it("serves an uncached handoff page that escapes the deep link it opens", () => {
    const response = googleOAuthAppResponse(
      new URL("com.tabaaq.desktop://auth/callback?code=a&next=b"),
    );
    const html = bodyText(response);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(html).toContain("You can close this tab and return to Tabaaq.");
    expect(html).toContain('href="com.tabaaq.desktop://auth/callback?code=a&amp;next=b"');
    expect(html).toContain('location.replace("com.tabaaq.desktop://auth/callback?code=a&next=b")');
  });
});

describe("oauthCallbackErrorResponse", () => {
  it("keeps the original status, escapes the message, and does not redirect", () => {
    const response = oauthCallbackErrorResponse(400, "<script>alert(1)</script>");
    const html = bodyText(response);
    expect(response.status).toBe(400);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("location.replace");
  });
});
