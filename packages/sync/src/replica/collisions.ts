import * as Effect from "effect/Effect";

const categoryNameCandidate = (name: string, suffix: number): string => `${name} (${suffix})`;

export const nextFreeCategoryName = <E, R>(
  name: string,
  isTaken: (candidate: string) => Effect.Effect<boolean, E, R>,
): Effect.Effect<string, E, R> =>
  Effect.gen(function* () {
    let suffix = 2;
    while (yield* isTaken(categoryNameCandidate(name, suffix))) suffix += 1;
    return categoryNameCandidate(name, suffix);
  });
