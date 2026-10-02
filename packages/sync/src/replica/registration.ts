import {
  purchasingBlockedByStaleReplica,
  ReplicaClientSequence,
  SYNC_SCHEMA_VERSION,
  SyncEpoch,
  type RegisterReplicaResult,
  type SyncCommandEnvelope,
  type SyncProtocolCode,
} from "@store/contracts";
import type { CommandStatus } from "@store/contracts/sync/replica-model";
import * as Array from "effect/Array";

import { byClientSequence } from "./decisions";

export const UNRECEIPTED_COMMAND_STATUSES: ReadonlyArray<CommandStatus> = ["pending", "sending"];

type RegistrationReplicaState = {
  readonly replicaId: string;
  readonly epoch: string;
  readonly incarnation: string;
  readonly registeredAt: number | null;
};

type RegistrationOutboxCommand = {
  readonly operationId: string;
  readonly clientSequence: string;
  readonly status: CommandStatus;
  readonly attempts: number;
  readonly envelope: SyncCommandEnvelope;
};

type RegistrationRestamp = {
  readonly operationId: string;
  readonly envelope: SyncCommandEnvelope;
};

type RegistrationDecision =
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
  if (state.registeredAt !== null) {
    return identityMismatch(state, authority) ?? { _tag: "unchanged" };
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

export type ReplicaAnnouncement = {
  readonly registered: boolean;
  readonly announcedSchemaVersion: number | undefined;
  readonly lowestActiveSchemaVersion: number | undefined;
};

export const shouldAnnounce = (announcement: ReplicaAnnouncement): boolean =>
  !announcement.registered ||
  announcement.announcedSchemaVersion !== SYNC_SCHEMA_VERSION ||
  purchasingBlockedByStaleReplica(announcement.lowestActiveSchemaVersion);

export const announcementFields = (authority: RegisterReplicaResult) => ({
  announcedSchemaVersion: SYNC_SCHEMA_VERSION,
  lowestActiveSchemaVersion: authority.lowestActiveSchemaVersion ?? null,
});

const announcementOf = (state: {
  readonly registeredAt: number | null;
  readonly announcedSchemaVersion?: number | null | undefined;
  readonly lowestActiveSchemaVersion?: number | null | undefined;
}): ReplicaAnnouncement => ({
  registered: state.registeredAt !== null,
  announcedSchemaVersion: state.announcedSchemaVersion ?? undefined,
  lowestActiveSchemaVersion: state.lowestActiveSchemaVersion ?? undefined,
});

export const syncCursorOf = (state: {
  readonly epoch: string;
  readonly appliedCommitSequence: string;
  readonly replicaId: string;
  readonly caughtUpAt: number | null;
  readonly activeGeneration: number;
  readonly registeredAt: number | null;
  readonly announcedSchemaVersion?: number | null | undefined;
  readonly lowestActiveSchemaVersion?: number | null | undefined;
}) => ({
  epoch: state.epoch,
  appliedCommitSequence: state.appliedCommitSequence,
  replicaId: state.replicaId,
  bootstrapped: state.caughtUpAt !== null || state.activeGeneration !== 1,
  ...announcementOf(state),
});
