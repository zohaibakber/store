import { LOCAL_ORGANIZATION_ID, LOCAL_USER_ID } from "@store/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Semaphore from "effect/Semaphore";

import { ReplicaWorkerFailure, type ReplicaOpenInput } from "./replica-rpc";

export const PROXY_CONCURRENCY = 4;
export const SNAPSHOT_DOWNLOAD_CONCURRENCY = 2;
const PERMANENT_STREAMS = 4;
const CONTROL_SLOTS = 8;
const FINITE_DATABASE_OPERATIONS = 2;
export const WORKER_RPC_CONCURRENCY =
  PERMANENT_STREAMS + CONTROL_SLOTS + FINITE_DATABASE_OPERATIONS;

const READER_CONTROL_SLOTS = 2;
const READER_FINITE_READS = 2;
export const READER_RPC_CONCURRENCY = READER_CONTROL_SLOTS + READER_FINITE_READS;

const LOCAL_REPLICA_KEY = `${LOCAL_ORGANIZATION_ID}-${LOCAL_USER_ID}`;

const PATH_SEPARATOR = /[\\/]/u;

const RESERVED_ORGANIZATION = LOCAL_ORGANIZATION_ID.toLowerCase();

const isReservedOrganization = (organizationId: string) =>
  organizationId.toLowerCase() === RESERVED_ORGANIZATION;

export const admitReplicaKey = (
  identity: typeof ReplicaOpenInput.Type,
): Result.Result<string, ReplicaWorkerFailure> => {
  switch (identity.authority) {
    case "local":
      return Result.succeed(LOCAL_REPLICA_KEY);
    case "remote": {
      const key = `${identity.organizationId}-${identity.userId}`;
      return isReservedOrganization(identity.organizationId) || PATH_SEPARATOR.test(key)
        ? Result.fail(
            new ReplicaWorkerFailure({
              message: "An organization workspace cannot open this catalog replica.",
            }),
          )
        : Result.succeed(key);
    }
  }
};

export type ReplicaAdmissionLimits = {
  readonly turnWait: Duration.Input;
  readonly turnRun: Duration.Input;
};

const DEFAULT_ADMISSION_LIMITS: ReplicaAdmissionLimits = {
  turnWait: Duration.seconds(30),
  turnRun: Duration.seconds(20),
};

export type ReplicaAdmission = {
  readonly write: <A, E, R>(
    work: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ReplicaWorkerFailure, R>;
  readonly read: <A, E, R>(
    work: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ReplicaWorkerFailure, R>;
};

const busy = (message: string) => new ReplicaWorkerFailure({ message });

const turnOf =
  (turn: Semaphore.Semaphore, limits: ReplicaAdmissionLimits, label: string) =>
  <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E | ReplicaWorkerFailure, R> =>
    Effect.scoped(
      Effect.gen(function* () {
        const admitted = yield* Effect.acquireRelease(turn.take(1), () => turn.release(1), {
          interruptible: true,
        }).pipe(Effect.timeoutOption(limits.turnWait));
        if (Option.isNone(admitted)) {
          return yield* busy(`The local database is busy with another ${label}.`);
        }
        const done = yield* Effect.timeoutOption(work, limits.turnRun);
        if (Option.isNone(done)) {
          return yield* busy(`The local database ${label} took too long.`);
        }
        return done.value;
      }),
    );

export const makeReplicaAdmission = (
  limits: ReplicaAdmissionLimits = DEFAULT_ADMISSION_LIMITS,
): Effect.Effect<ReplicaAdmission> =>
  Effect.gen(function* () {
    const writer = yield* Semaphore.make(1);
    const reader = yield* Semaphore.make(1);
    return {
      write: turnOf(writer, limits, "write"),
      read: turnOf(reader, limits, "read"),
    };
  });
