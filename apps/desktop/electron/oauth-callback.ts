export const oauthCallbackRedirectUri = (scheme: string) => `${scheme}://auth/callback`;

export const isOAuthCallbackUrl = (candidate: string, scheme: string) => {
  try {
    const url = new URL(candidate);
    return url.protocol === `${scheme}:` && url.hostname === "auth" && url.pathname === "/callback";
  } catch {
    return false;
  }
};
