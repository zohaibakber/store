import { isNativeRedirect } from "@store/auth";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

const callbackPageHeaders = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });

const page = (input: {
  readonly title: string;
  readonly heading: string;
  readonly body: string;
  readonly actionHref?: string;
  readonly actionLabel?: string;
}) => {
  const action =
    input.actionHref && input.actionLabel
      ? `<p><a href="${escapeHtml(input.actionHref)}">${escapeHtml(input.actionLabel)}</a></p>`
      : "";
  const openApp =
    input.actionHref === undefined
      ? ""
      : `<script>location.replace(${JSON.stringify(input.actionHref)})</script>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
:root { color-scheme: light dark; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
  color: #171717;
  background: #fafafa;
}
main { max-width: 22rem; padding: 1.5rem; text-align: center; }
h1 { margin: 0 0 0.5rem; font-size: 18px; font-weight: 500; }
p { margin: 0 0 0.5rem; color: #525252; }
a { color: #171717; font-weight: 500; }
@media (prefers-color-scheme: dark) {
  body { color: #fafafa; background: #171717; }
  p { color: #a3a3a3; }
  a { color: #fafafa; }
}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(input.heading)}</h1>
<p>${escapeHtml(input.body)}</p>
${action}
</main>
${openApp}
</body>
</html>`;
};

export const nativeOAuthHandoffHtml = (appUrl: URL) =>
  page({
    title: "Signed in — Tabaaq",
    heading: "You're signed in",
    body: "You can close this tab and return to Tabaaq.",
    actionHref: appUrl.href,
    actionLabel: "Open Tabaaq",
  });

export const oauthCallbackErrorHtml = (message: string) =>
  page({
    title: "Sign-in didn't finish — Tabaaq",
    heading: "Sign-in didn't finish",
    body: `${message} You can close this tab and try again in Tabaaq.`,
  });

const htmlResponse = (html: string, status = 200) =>
  HttpServerResponse.setHeaders(
    HttpServerResponse.setStatus(HttpServerResponse.html(html), status),
    callbackPageHeaders,
  );

export const nativeOAuthHandoffResponse = (appUrl: URL) =>
  htmlResponse(nativeOAuthHandoffHtml(appUrl));

export const oauthCallbackErrorResponse = (status: number, message: string) =>
  htmlResponse(oauthCallbackErrorHtml(message), status);

export const googleOAuthAppResponse = (redirect: URL) =>
  isNativeRedirect(redirect.href)
    ? nativeOAuthHandoffResponse(redirect)
    : HttpServerResponse.redirect(redirect);
