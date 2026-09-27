export const OAUTH_CALLBACK_CHANNEL = "auth:oauth-callback";

export const oauthCallbackRedirectUri = (scheme: string) => `${scheme}://auth/callback`;

/**
 * The one allow-list for OAuth callback deep links. Main applies it before a
 * URL reaches the window, and the preload applies it again before a URL
 * reaches the renderer.
 */
export const isOAuthCallbackUrl = (candidate: string, scheme: string) => {
  try {
    const url = new URL(candidate);
    return url.protocol === `${scheme}:` && url.hostname === "auth" && url.pathname === "/callback";
  } catch {
    return false;
  }
};
