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
  readonly exchangeOnce: Effect.Effect<ExchangeProgress, E>;
  readonly completedStatus: Effect.Effect<SyncStatus, E>;
  readonly failureStatus: (error: E) => Effect.Effect<SyncStatus>;
  readonly retryable: (error: E) => boolean;
  readonly tooManyRounds: (maximumRounds: number) => E;
}

export interface LiveTransport<E> {
  /** A fresh subscription creates a fresh authenticated WebSocket. */
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
  readonly maximumExchangeRounds?: number;
}
