type ReplayState<Value> =
  | { readonly _tag: "Empty" }
  | { readonly _tag: "Published"; readonly value: Value };

export type ReplayChannel<Value> = {
  readonly publish: (value: Value) => void;
  readonly current: () => Value | undefined;
  readonly subscribe: (listener: (value: Value) => void) => () => void;
};

export const makeReplayChannel = <Value>(): ReplayChannel<Value> => {
  const listeners = new Set<(value: Value) => void>();
  let state: ReplayState<Value> = { _tag: "Empty" };

  return {
    publish: (value: Value) => {
      state = { _tag: "Published", value };
      for (const listener of listeners) listener(value);
    },
    current: () => (state._tag === "Published" ? state.value : undefined),
    subscribe: (listener: (value: Value) => void) => {
      listeners.add(listener);
      if (state._tag === "Published") listener(state.value);
      return () => listeners.delete(listener);
    },
  };
};
