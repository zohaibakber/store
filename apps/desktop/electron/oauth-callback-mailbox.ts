export interface OAuthCallbackMailbox {
  readonly offer: (candidate: string) => boolean;
  readonly take: () => string | null;
}

const isCallbackFor = (candidate: string, scheme: string) => {
  try {
    const url = new URL(candidate);
    return url.protocol === `${scheme}:` && url.hostname === "auth" && url.pathname === "/callback";
  } catch {
    return false;
  }
};

/** Keeps the latest callback until the sandboxed renderer explicitly claims it. */
export const makeOAuthCallbackMailbox = (
  scheme: string,
  notify: () => void,
): OAuthCallbackMailbox => {
  let pending: string | null = null;
  return {
    offer(candidate) {
      if (!isCallbackFor(candidate, scheme)) return false;
      pending = candidate;
      notify();
      return true;
    },
    take() {
      const callback = pending;
      pending = null;
      return callback;
    },
  };
};
