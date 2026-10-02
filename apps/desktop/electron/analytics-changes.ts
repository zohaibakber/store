import type { ReplicaCommitNotice } from "@store/client-db";
import type { InventoryStamp } from "@store/client-db/node-analytics";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

const JOURNAL_LIMIT = 4_096;
const COVERAGE_TIMEOUT = Duration.seconds(10);

export const RELEVANT_ENTITIES = [
  "product",
  "batch",
  "invoice",
  "invoiceItem",
  "category",
  "purchaseOrder",
  "purchaseOrderItem",
] as const;

const RELEVANT: ReadonlySet<string> = new Set(RELEVANT_ENTITIES);

type ChangeWindow =
  | { readonly kind: "keys"; readonly keys: ReadonlySet<string> }
  | { readonly kind: "reset" };

export type ChangeFeed = {
  readonly since: (from: InventoryStamp, through: InventoryStamp) => Effect.Effect<ChangeWindow>;
};

type ChangeJournal = {
  readonly record: (notice: ReplicaCommitNotice) => Effect.Effect<void>;
  readonly track: <A, E, R>(
    use: (feed: ChangeFeed) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
};

type JournalState = {
  readonly latest: InventoryStamp | undefined;
  readonly recording: boolean;
  readonly overflowed: boolean;
  readonly notices: ReadonlyArray<ReplicaCommitNotice>;
};

const RESET: ChangeWindow = { kind: "reset" };

const newer = (latest: InventoryStamp | undefined, notice: ReplicaCommitNotice): InventoryStamp =>
  latest !== undefined &&
  latest.generation === notice.generationId &&
  latest.version >= notice.localCommitVersion
    ? latest
    : { generation: notice.generationId, version: notice.localCommitVersion };

const covers = (state: JournalState, through: InventoryStamp) =>
  state.overflowed ||
  (state.latest !== undefined &&
    (state.latest.generation !== through.generation || state.latest.version >= through.version));

const keyEntity = (key: string) => key.slice(0, Math.max(0, key.indexOf(":")));

const changedKeys = (
  notices: ReadonlyArray<ReplicaCommitNotice>,
  from: InventoryStamp,
  through: InventoryStamp,
): ChangeWindow => {
  const keys = new Set<string>();
  for (const notice of notices) {
    if (notice.localCommitVersion <= from.version) continue;
    if (notice.generationId !== through.generation || notice.fullInvalidation === true)
      return RESET;
    if (notice.overflowedEntities?.some((entity) => RELEVANT.has(entity)) === true) return RESET;
    for (const key of notice.touchedKeys) if (RELEVANT.has(keyEntity(key))) keys.add(key);
    if (notice.localCommitVersion >= through.version) break;
  }
  return { kind: "keys", keys };
};

export const makeChangeJournal = (): Effect.Effect<ChangeJournal> =>
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make<JournalState>({
      latest: undefined,
      recording: false,
      overflowed: false,
      notices: [],
    });

    const since = (from: InventoryStamp, through: InventoryStamp): Effect.Effect<ChangeWindow> =>
      Effect.gen(function* () {
        if (through.generation !== from.generation) return RESET;
        if (through.version <= from.version) return { kind: "keys", keys: new Set<string>() };
        const covered = yield* SubscriptionRef.changes(state).pipe(
          Stream.filter((current) => covers(current, through)),
          Stream.runHead,
          Effect.timeoutOption(COVERAGE_TIMEOUT),
          Effect.map(Option.flatten),
        );
        if (Option.isNone(covered) || covered.value.overflowed) return RESET;
        return changedKeys(covered.value.notices, from, through);
      });

    const reset = (recording: boolean) =>
      SubscriptionRef.update(state, (current) => ({
        ...current,
        recording,
        overflowed: false,
        notices: [],
      }));

    return {
      record: (notice) =>
        SubscriptionRef.update(state, (current) => {
          const latest = newer(current.latest, notice);
          if (!current.recording) return { ...current, latest };
          return current.notices.length >= JOURNAL_LIMIT
            ? { ...current, latest, overflowed: true }
            : { ...current, latest, notices: [...current.notices, notice] };
        }),
      track: (use) =>
        Effect.acquireUseRelease(
          reset(true),
          () => use({ since }),
          () => reset(false),
        ),
    } satisfies ChangeJournal;
  });
