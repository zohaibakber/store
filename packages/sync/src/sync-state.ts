import {
  compareDecimalSequence,
  type OrgCommitSequence,
  type SyncEpoch,
  type SyncProtocolCode,
} from "@store/contracts";

export type SuspendReason =
  | "auth"
  | "garbledResponses"
  | "refused"
  | "protocol"
  | "updateRequired"
  | "storage"
  | "recoveryRequired";

export type Suspension = {
  readonly reason: SuspendReason;
  readonly message: string;
  readonly code?: SyncProtocolCode;
  readonly status?: number;
  readonly blocks: "all" | "uploads";
  readonly timer: boolean;
};

export type SyncPhase =
  | "idle"
  | "registering"
  | "uploading"
  | "catchingUp"
  | "recovering"
  | "following";

export type SyncCursor = {
  readonly epoch: SyncEpoch;
  readonly applied: OrgCommitSequence;
  readonly horizon?: OrgCommitSequence;
};

export type SyncTransfer = { readonly partsDone: number; readonly partsTotal: number };

export type SyncState = {
  readonly phase: SyncPhase;
  readonly cursor: SyncCursor | undefined;
  readonly transfer?: SyncTransfer;
  readonly live: boolean;
  readonly owner: boolean;
  readonly suspended?: {
    readonly reason: SuspendReason;
    readonly message: string;
    readonly retryAt?: number;
  };
};

export const initialSyncState: SyncState = {
  phase: "idle",
  cursor: undefined,
  live: false,
  owner: false,
};

export const restingPhase = (cursor: SyncCursor | undefined): SyncPhase =>
  cursor !== undefined &&
  cursor.horizon !== undefined &&
  compareDecimalSequence(cursor.applied, cursor.horizon) >= 0
    ? "following"
    : "idle";

const isResting = (phase: SyncPhase): boolean => phase === "idle" || phase === "following";

export const isFollowing = (state: SyncState): boolean =>
  restingPhase(state.cursor) === "following";

export const withCursor = (state: SyncState, cursor: SyncCursor | undefined): SyncState => ({
  ...state,
  cursor,
  phase: isResting(state.phase) ? restingPhase(cursor) : state.phase,
});

export const withRecovering = (state: SyncState): SyncState => ({ ...state, phase: "recovering" });

export const withTransfer = (state: SyncState, transfer: SyncTransfer): SyncState => ({
  ...state,
  transfer,
});

export const withRecoveryEnded = (state: SyncState, previous: SyncPhase): SyncState => {
  const { transfer: _transfer, ...rest } = state;
  return { ...rest, phase: state.phase === "recovering" ? previous : state.phase };
};
