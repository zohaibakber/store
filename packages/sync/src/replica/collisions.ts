import * as Effect from "effect/Effect";

const nameCandidate = (name: string, suffix: number): string => `${name} (${suffix})`;

export const nextFreeName = <E, R>(
  name: string,
  isTaken: (candidate: string) => Effect.Effect<boolean, E, R>,
): Effect.Effect<string, E, R> =>
  Effect.gen(function* () {
    let suffix = 2;
    while (yield* isTaken(nameCandidate(name, suffix))) suffix += 1;
    return nameCandidate(name, suffix);
  });
