import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { describe, expect, it } from "vitest";

import {
  googleOAuthAppResponse,
  nativeOAuthHandoffHtml,
  oauthCallbackErrorHtml,
  oauthCallbackErrorResponse,
} from "../src/oauth-callback-page";

const bodyText = (response: HttpServerResponse.HttpServerResponse) => {
  if (!HttpBody.isHttpBody(response.body) || response.body._tag !== "Uint8Array") {
    throw new Error(`unexpected body ${response.body._tag}`);
  }
  return new TextDecoder().decode(response.body.body);
};

describe("native OAuth handoff page", () => {
  it("tells the user they can close the leftover browser tab", () => {
    const html = nativeOAuthHandoffHtml(new URL("com.tabaaq.desktop://auth/callback?code=abc"));
    expect(html).toContain("You&#39;re signed in");
    expect(html).toContain("You can close this tab and return to Tabaaq.");
    expect(html).toContain("Open Tabaaq");
    expect(html).toContain("com.tabaaq.desktop://auth/callback?code=abc");
    expect(html).toContain("location.replace");
  });

  it("escapes the deep link before embedding it in HTML", () => {
    const html = nativeOAuthHandoffHtml(
      new URL("com.tabaaq.desktop://auth/callback?code=a&next=b"),
    );
    expect(html).toContain('href="com.tabaaq.desktop://auth/callback?code=a&amp;next=b"');
    expect(html).toContain('location.replace("com.tabaaq.desktop://auth/callback?code=a&next=b")');
  });
});

describe("OAuth callback error page", () => {
  it("keeps the leftover tab on an HTML close message", () => {
    const html = oauthCallbackErrorHtml("Google sign-in was cancelled.");
    expect(html).toContain("Sign-in didn&#39;t finish");
    expect(html).toContain("Google sign-in was cancelled.");
    expect(html).toContain("You can close this tab and try again in Tabaaq.");
    expect(html).not.toContain("location.replace");
  });

  it("escapes the error message", () => {
    expect(oauthCallbackErrorHtml("<script>alert(1)</script>")).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });
});

describe("googleOAuthAppResponse", () => {
  it("serves HTML for a custom-scheme desktop callback", () => {
    const response = googleOAuthAppResponse(
      new URL("com.tabaaq.desktop://auth/callback?code=grant"),
    );
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(bodyText(response)).toContain("You can close this tab and return to Tabaaq.");
  });

  it("keeps a 302 for the hosted web origin", () => {
    const response = googleOAuthAppResponse(new URL("https://app.example.com/?code=grant"));
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("https://app.example.com/?code=grant");
  });

  it("returns HTML errors with the original status", () => {
    const response = oauthCallbackErrorResponse(400, "Google sign-in was cancelled.");
    expect(response.status).toBe(400);
    expect(bodyText(response)).toContain("Google sign-in was cancelled.");
  });
});
