import { describe, expect, it, vi } from "vitest";

import { makeShutdownCoordinator } from "../../electron/shutdown";

describe("desktop shutdown coordinator", () => {
  it("prevents quit until cleanup finishes and resumes exactly once", async () => {
    let release!: () => void;
    const dispose = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const quit = vi.fn();
    const preventDefault = vi.fn();
    const shutdown = makeShutdownCoordinator({ dispose, quit });

    shutdown({ preventDefault });
    shutdown({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();

    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(quit).toHaveBeenCalledOnce();

    shutdown({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("reports cleanup failure and still allows process exit", async () => {
    const failure = new Error("dispose failed");
    const reportError = vi.fn();
    const quit = vi.fn();
    const shutdown = makeShutdownCoordinator({
      dispose: () => Promise.reject(failure),
      quit,
      reportError,
    });

    shutdown({ preventDefault: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();

    expect(reportError).toHaveBeenCalledWith(failure);
    expect(quit).toHaveBeenCalledOnce();
  });
});
