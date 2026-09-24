import {
  ReplicaClientSequence,
  SyncEpoch,
  type RegisterReplicaResult,
  type SyncCommandEnvelope,
  type SyncProtocolCode,
} from "@store/contracts";
import type { CommandStatus } from "@store/contracts/sync/replica-model";
import * as Array from "effect/Array";

import { byClientSequence } from "./decisions";

export const PLACEHOLDER_INCARNATION = "local";

export const UNRECEIPTED_COMMAND_STATUSES: ReadonlyArray<CommandStatus> = ["pending", "sending"];

export type RegistrationReplicaState = {
  readonly replicaId: string;
  readonly epoch: string;
  readonly incarnation: string;
  readonly appliedCommitSequence: string;
  readonly registeredAt?: number | null | undefined;
};

export type RegistrationOutboxCommand = {
  readonly operationId: string;
  readonly clientSequence: string;
  readonly status: CommandStatus;
  readonly attempts: number;
  readonly envelope: SyncCommandEnvelope;
};

export type RegistrationRestamp = {
  readonly operationId: string;
  readonly envelope: SyncCommandEnvelope;
};

export type RegistrationDecision =
  | { readonly _tag: "unchanged" }
  | {
      readonly _tag: "adopt";
      readonly epoch: string;
      readonly incarnation: string;
      readonly nextClientSequence: string;
      readonly restamp: ReadonlyArray<RegistrationRestamp>;
    }
  | { readonly _tag: "refuse"; readonly code: SyncProtocolCode; readonly message: string };

const identityMismatch = (
  state: RegistrationReplicaState,
  authority: RegisterReplicaResult,
): RegistrationDecision | undefined => {
  if (state.epoch !== authority.epoch) {
    return {
      _tag: "refuse",
      code: "EPOCH_MISMATCH",
      message: "The sync authority was restored or re-keyed; unsent commands are preserved.",
    };
  }
  if (state.incarnation !== authority.incarnation) {
    return {
      _tag: "refuse",
      code: "INCARNATION_MISMATCH",
      message: "The sync authority was restored or re-keyed; unsent commands are preserved.",
    };
  }
  return undefined;
};

const wasSent = (command: RegistrationOutboxCommand): boolean =>
  command.status !== "pending" || command.attempts > 0;

const advance = (sequence: string, steps: number): string =>
  String(BigInt(sequence) + BigInt(steps));

export const decideRegistration = (
  state: RegistrationReplicaState,
  outbox: ReadonlyArray<RegistrationOutboxCommand>,
  authority: RegisterReplicaResult,
): RegistrationDecision => {
  if (authority.replicaId !== state.replicaId) {
    return {
      _tag: "refuse",
      code: "COMMAND_IDENTITY_MISMATCH",
      message: "The authority registered a different replica identity.",
    };
  }
  const registered = state.registeredAt !== undefined && state.registeredAt !== null;
  const fresh =
    !registered &&
    state.incarnation === PLACEHOLDER_INCARNATION &&
    state.appliedCommitSequence === "0";
  if (!fresh) {
    const mismatch = identityMismatch(state, authority);
    if (mismatch !== undefined) return mismatch;
    if (registered) return { _tag: "unchanged" };
  }
  const allocations = Array.sort(
    outbox.filter((command) => UNRECEIPTED_COMMAND_STATUSES.includes(command.status)),
    byClientSequence,
  ).map((command, index) => ({
    command,
    clientSequence: advance(authority.nextClientSequence, index),
  }));
  const epoch = SyncEpoch.make(authority.epoch);
  const conflicting = allocations.filter(
    ({ command, clientSequence }) =>
      command.clientSequence !== clientSequence || command.envelope.epoch !== epoch,
  );
  if (conflicting.some(({ command }) => wasSent(command))) {
    return {
      _tag: "refuse",
      code: "COMMAND_IDENTITY_MISMATCH",
      message:
        "Commands sent before registration conflict with the authority's replica sequence; unsent commands are preserved.",
    };
  }
  return {
    _tag: "adopt",
    epoch: authority.epoch,
    incarnation: authority.incarnation,
    nextClientSequence: advance(authority.nextClientSequence, allocations.length),
    restamp: conflicting.map(({ command, clientSequence }) => ({
      operationId: command.operationId,
      envelope: {
        ...command.envelope,
        epoch,
        clientSequence: ReplicaClientSequence.make(clientSequence),
      },
    })),
  };
};

export type ReplicaRegistrationOutcome =
  | { readonly _tag: "registered" }
  | { readonly _tag: "refused"; readonly code: SyncProtocolCode; readonly message: string };
