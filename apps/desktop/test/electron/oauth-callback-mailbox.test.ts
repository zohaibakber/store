import { describe, expect, it, vi } from "vitest";

import { makeOAuthCallbackMailbox } from "../../electron/oauth-callback-mailbox";

describe("desktop OAuth callback mailbox", () => {
  it("replays a callback that arrived before the renderer subscribed", () => {
    const notify = vi.fn();
    const mailbox = makeOAuthCallbackMailbox("com.tabaaq.desktop", notify);
    const callback = "com.tabaaq.desktop://auth/callback?code=authorization-code";

    expect(mailbox.offer(callback)).toBe(true);
    expect(notify).toHaveBeenCalledOnce();
    expect(mailbox.take()).toBe(callback);
    expect(mailbox.take()).toBeNull();
  });

  it("rejects other paths and schemes", () => {
    const mailbox = makeOAuthCallbackMailbox("com.tabaaq.desktop", vi.fn());

    expect(mailbox.offer("https://auth/callback?code=authorization-code")).toBe(false);
    expect(mailbox.offer("com.tabaaq.desktop://auth/not-callback?code=authorization-code")).toBe(
      false,
    );
    expect(mailbox.take()).toBeNull();
  });
});
