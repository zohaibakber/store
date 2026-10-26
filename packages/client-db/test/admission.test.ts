import { expect, it } from "@effect/vitest";
import { ReplicaUnavailable } from "@store/contracts/replica";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";

import { CommandAdmission } from "../src/store/admission";

const reasonOf = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.flip(effect).pipe(
    Effect.map((failure) => (failure instanceof ReplicaUnavailable ? failure.reason : failure)),
  );

it.effect("a stuck command gives up its turn so the next command runs", () =>
  Effect.gen(function* () {
    const admission = yield* CommandAdmission;
    const stuck = yield* Effect.forkChild(admission.admit(Effect.never));
    yield* Effect.yieldNow;
    const next = yield* Effect.forkChild(admission.admit(Effect.succeed("ran")));
    yield* Effect.yieldNow;
    yield* TestClock.adjust("20 seconds");
    expect(yield* reasonOf(Fiber.join(stuck))).toBe("busy");
    expect(yield* Fiber.join(next)).toBe("ran");
  }).pipe(Effect.provide(CommandAdmission.layer)),
);

it.effect("a command that cannot get its turn is refused as busy instead of waiting forever", () =>
  Effect.gen(function* () {
    const admission = yield* CommandAdmission;
    const holder = yield* Effect.forkChild(admission.exclusive(Effect.never));
    yield* Effect.yieldNow;
    const waiting = yield* Effect.forkChild(admission.admit(Effect.succeed("ran")));
    yield* Effect.yieldNow;
    yield* TestClock.adjust("29 seconds");
    expect(waiting.pollUnsafe()).toBeUndefined();
    yield* TestClock.adjust("1 second");
    expect(yield* reasonOf(Fiber.join(waiting))).toBe("busy");
    yield* Fiber.interrupt(holder);
  }).pipe(Effect.provide(CommandAdmission.layer)),
);
