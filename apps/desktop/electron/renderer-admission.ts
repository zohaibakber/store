import { InventoryReads, InventoryStore, ReplicaUnavailable } from "@store/contracts/replica";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import type * as Semaphore from "effect/Semaphore";

type AdmissionLimits = {
  readonly turnWait: Duration.Input;
  readonly turnRun: Duration.Input;
};

const DEFAULT_ADMISSION_LIMITS: AdmissionLimits = {
  turnWait: Duration.seconds(30),
  turnRun: Duration.seconds(20),
};

const takeTurn =
  <F>(turn: Semaphore.Semaphore, limits: AdmissionLimits, busy: () => F) =>
  <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E | F, R> =>
    Effect.scoped(
      Effect.gen(function* () {
        const admitted = yield* Effect.acquireRelease(turn.take(1), () => turn.release(1), {
          interruptible: true,
        }).pipe(Effect.timeoutOption(limits.turnWait));
        if (Option.isNone(admitted)) return yield* Effect.fail(busy());
        const done = yield* Effect.timeoutOption(work, limits.turnRun);
        if (Option.isNone(done)) return yield* Effect.fail(busy());
        return done.value;
      }),
    );

const busy = () => new ReplicaUnavailable({ reason: "busy" });

export class CommandAdmission extends RpcMiddleware.Service<CommandAdmission>()(
  "@store/desktop/CommandAdmission",
  { error: ReplicaUnavailable },
) {}

export class ReadDeadline extends RpcMiddleware.Service<ReadDeadline>()(
  "@store/desktop/ReadDeadline",
  { error: ReplicaUnavailable },
) {}

export const AdmittedInventoryStore = InventoryStore.middleware(CommandAdmission);

export const TimedInventoryReads = InventoryReads.middleware(ReadDeadline);

const UNSERIALISED_TAGS = [
  "Commits",
  "Health",
  "Stamp",
  "SyncActivity",
  "PendingRows",
  "WakeSyncUpload",
] as const satisfies ReadonlyArray<RpcGroup.Rpcs<typeof InventoryStore>["_tag"]>;

const UNSERIALISED: ReadonlySet<string> = new Set(UNSERIALISED_TAGS);

export const commandAdmission = (
  turn: Semaphore.Semaphore,
  limits = DEFAULT_ADMISSION_LIMITS,
): CommandAdmission["Service"] => {
  const admitted = takeTurn(turn, limits, busy);
  return (effect, { rpc }) => (UNSERIALISED.has(rpc._tag) ? effect : admitted(effect));
};

export const readDeadline =
  (limits = DEFAULT_ADMISSION_LIMITS): ReadDeadline["Service"] =>
  (effect) =>
    Effect.timeoutOrElse(effect, {
      duration: limits.turnRun,
      orElse: () => Effect.fail(busy()),
    });
