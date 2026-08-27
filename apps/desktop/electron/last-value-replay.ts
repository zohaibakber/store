export const makeLastValueReplay = <Value>() => {
  const listeners = new Set<(value: Value) => void>();
  let last: Value | undefined;

  return {
    publish: (value: Value) => {
      last = value;
      for (const listener of listeners) listener(value);
    },
    current: () => last,
    subscribe: (listener: (value: Value) => void) => {
      listeners.add(listener);
      if (last !== undefined) listener(last);
      return () => listeners.delete(listener);
    },
  };
};
