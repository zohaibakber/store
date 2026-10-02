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
