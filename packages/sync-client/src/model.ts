import type { SyncLiveEvent, SyncStatus } from "@store/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

export type SyncReason = "startup" | "local-commit" | "manual" | "live" | "safety-poll";

export interface ExchangeProgress {
  readonly cursor: number;
  readonly hasMore: boolean;
  readonly moreLocalWork: boolean;
}

export interface SyncAdapter<E> {
  readonly exchangeOnce: (reason: SyncReason) => Effect.Effect<ExchangeProgress, E>;
  readonly completedStatus: Effect.Effect<SyncStatus, E>;
  readonly failureStatus: (error: E) => Effect.Effect<SyncStatus>;
  readonly retryable: (error: E) => boolean;
  readonly tooManyRounds: (maximumRounds: number) => E;
  /**
   * After a failed exchange, delay before the runtime re-signals sync so a
   * live session does not sit idle until the 5-minute safety poll. `null`
   * skips the wake (non-retryable / quarantined).
   */
  readonly retryAfterFailureMillis?: (error: E) => Effect.Effect<number | null>;
}

export interface LiveTransport<E> {
  /** Optional invalidation and hello stream. Production hosts open a live socket. */
  readonly events: Stream.Stream<SyncLiveEvent, E>;
}

export interface RuntimeOptions<E, LiveE> {
  readonly initialStatus: SyncStatus;
  readonly adapter: SyncAdapter<E>;
  readonly live?: LiveTransport<LiveE>;
  readonly safetyPollIntervalMillis?: number;
  readonly exchangeRetryBaseMillis?: number;
  readonly liveRetryBaseMillis?: number;
  readonly liveRetryCapMillis?: number;
  /** How long the first sync waits for a live hello before exchanging anyway. */
  readonly liveConnectTimeoutMillis?: number;
  readonly maximumExchangeRounds?: number;
}
