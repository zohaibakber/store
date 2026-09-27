/**
 * Latest-value channel: a subscriber first receives the current value, if one
 * has been published, and then every later publication.
 *
 * Dependency-free on purpose. The sandboxed preload uses it to hold IPC
 * notices that arrive before the renderer subscribes, and the renderer uses it
 * for the workspace session, which React reads through `useSyncExternalStore`.
 */
export type ReplayChannel<Value> = {
  readonly publish: (value: Value) => void;
  readonly current: () => Value | undefined;
  readonly subscribe: (listener: (value: Value) => void) => () => void;
};

export const makeReplayChannel = <Value>(): ReplayChannel<Value> => {
  const listeners = new Set<(value: Value) => void>();
  let latest: Value | undefined;
  return {
    publish: (value) => {
      latest = value;
      for (const listener of listeners) listener(value);
    },
    current: () => latest,
    subscribe: (listener) => {
      listeners.add(listener);
      if (latest !== undefined) listener(latest);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
