import { describe, expect, it, vi } from "vitest";

import { makeReplayChannel } from "../src/replay-channel";

describe("replay channel", () => {
  it("waits for the first publication before notifying an early subscriber", () => {
    const channel = makeReplayChannel<string>();
    const listener = vi.fn();

    channel.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();

    channel.publish("authenticated");
    expect(listener).toHaveBeenCalledExactlyOnceWith("authenticated");
  });

  it("replays the latest publication to a late subscriber", () => {
    const channel = makeReplayChannel<string>();
    channel.publish("authenticated");
    const listener = vi.fn();

    channel.subscribe(listener);

    expect(listener).toHaveBeenCalledExactlyOnceWith("authenticated");
  });

  it("stops notifying a disposed subscriber", () => {
    const channel = makeReplayChannel<string>();
    const listener = vi.fn();
    const dispose = channel.subscribe(listener);

    dispose();
    channel.publish("authenticated");

    expect(listener).not.toHaveBeenCalled();
  });

  it("exposes the latest publication through current()", () => {
    const channel = makeReplayChannel<string>();
    expect(channel.current()).toBeUndefined();
    channel.publish("authenticated");
    expect(channel.current()).toBe("authenticated");
    channel.publish("unauthenticated");
    expect(channel.current()).toBe("unauthenticated");
  });
});
