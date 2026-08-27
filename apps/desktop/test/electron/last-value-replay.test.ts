import { describe, expect, it, vi } from "vitest";

import { makeLastValueReplay } from "../../electron/last-value-replay";

describe("last-value session replay", () => {
  it("replays the last snapshot to a late subscriber", () => {
    const replay = makeLastValueReplay<string>();
    replay.publish("authenticated");
    const listener = vi.fn();
    replay.subscribe(listener);
    expect(listener).toHaveBeenCalledExactlyOnceWith("authenticated");
  });

  it("forwards later publishes after replay", () => {
    const replay = makeLastValueReplay<string>();
    replay.publish("authenticated");
    const listener = vi.fn();
    replay.subscribe(listener);
    replay.publish("unauthenticated");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith("unauthenticated");
    expect(replay.current()).toBe("unauthenticated");
  });
});
