type ReplayState<Value> =
  | { readonly _tag: "Empty" }
  | { readonly _tag: "Published"; readonly value: Value };

export const makeReplayChannel = <Value>() => {
  const listeners = new Set<(value: Value) => void>();
  let state: ReplayState<Value> = { _tag: "Empty" };

  return {
    publish: (value: Value) => {
      state = { _tag: "Published", value };
      for (const listener of listeners) listener(value);
    },
    subscribe: (listener: (value: Value) => void) => {
      listeners.add(listener);
      if (state._tag === "Published") listener(state.value);
      return () => listeners.delete(listener);
    },
  };
};
