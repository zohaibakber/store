import type { ProductScanMode } from "@store/contracts/server-api.schema";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { randomUUID } from "expo-crypto";
import { useNetworkState } from "expo-network";
import * as React from "react";

import { useSession } from "@/auth";
import { mobileConfig } from "@/config";

import { DraftStore, fileDraftStore } from "./draft-store";
import { sameEdits } from "./fields";
import type { ParseState, ReviewEdits, ScanDraft } from "./model";
import {
  type ParseEnvironment,
  eligibleForParse,
  makeScanQueues,
  runScanWorker,
} from "./parse-worker";

type NewDraft = {
  readonly mode: ProductScanMode;
  readonly capturedPath: string | null;
  readonly recognizedText: string;
  readonly lines: ReadonlyArray<string>;
};

type ScanDrafts = {
  readonly drafts: ReadonlyArray<ScanDraft>;
  readonly loaded: boolean;
  readonly parsing: ReadonlySet<string>;
  readonly pausedUntil: number | null;
  readonly online: boolean;
  readonly lastCommit: string | null;
  readonly createDraft: (input: NewDraft) => Promise<ScanDraft>;
  readonly requestParse: (draftId: string) => void;
  readonly setPacks: (draftId: string, packs: number) => void;
  readonly setParse: (draftId: string, parse: ParseState) => void;
  readonly saveEdits: (draftId: string, edits: ReviewEdits) => void;
  readonly removeDraft: (draftId: string) => void;
  readonly noteCommit: (message: string) => void;
};

const ScanDraftsContext = React.createContext<ScanDrafts | null>(null);

const runtime = ManagedRuntime.make(Layer.merge(fileDraftStore, FetchHttpClient.layer));

const persist = (draft: ScanDraft) =>
  runtime.runFork(
    DraftStore.use((store) => store.save(draft)).pipe(
      Effect.tapError((error) => Effect.logError("Scan draft not saved", error)),
      Effect.ignore,
    ),
  );

export function ScanDraftsProvider({ children }: { readonly children: React.ReactNode }) {
  const session = useSession();
  const network = useNetworkState();
  const online = network.isConnected !== false && network.isInternetReachable !== false;
  const fetch = session.status === "signedIn" ? session.authenticatedFetch : null;

  const [drafts, setDrafts] = React.useState<ReadonlyMap<string, ScanDraft>>(() => new Map());
  const [loaded, setLoaded] = React.useState(false);
  const [parsing, setParsing] = React.useState<ReadonlySet<string>>(() => new Set());
  const [lastCommit, setLastCommit] = React.useState<string | null>(null);

  const draftsRef = React.useRef(drafts);
  const environmentRef = React.useRef<ParseEnvironment>({ online, fetch });
  const [queues] = React.useState(makeScanQueues);

  React.useEffect(() => {
    environmentRef.current = { online, fetch };
  }, [online, fetch]);

  const commitDrafts = React.useCallback(
    (next: (current: ReadonlyMap<string, ScanDraft>) => ReadonlyMap<string, ScanDraft>) => {
      draftsRef.current = next(draftsRef.current);
      setDrafts(draftsRef.current);
      queues.changed();
    },
    [queues],
  );

  const writeDraft = React.useCallback(
    (draft: ScanDraft) => {
      commitDrafts((current) => new Map(current).set(draft.id, draft));
      persist(draft);
    },
    [commitDrafts],
  );

  const setParse = React.useCallback(
    (draftId: string, parse: ParseState) => {
      const draft = draftsRef.current.get(draftId);
      if (draft) writeDraft({ ...draft, parse, updatedAt: Date.now() });
    },
    [writeDraft],
  );

  const requestParse = React.useCallback(
    (draftId: string) => {
      queues.request(draftId);
    },
    [queues],
  );

  React.useEffect(() => {
    let active = true;
    void runtime.runPromise(DraftStore.use((store) => store.list)).then(
      (stored) => {
        if (!active) return;
        commitDrafts((current) => {
          const merged = new Map(stored.map((draft) => [draft.id, draft] as const));
          for (const [id, draft] of current) merged.set(id, draft);
          return merged;
        });
        setLoaded(true);
      },
      () => {
        if (active) setLoaded(true);
      },
    );
    return () => {
      active = false;
    };
  }, [commitDrafts]);

  React.useEffect(() => {
    const worker = runtime.runFork(
      runScanWorker(
        {
          apiBaseUrl: mobileConfig.apiBaseUrl,
          drafts: () => draftsRef.current,
          environment: () => environmentRef.current,
          setParse,
          setParsing: (draftId, active) =>
            setParsing((current) => {
              if (current.has(draftId) === active) return current;
              const next = new Set(current);
              if (active) next.add(draftId);
              else next.delete(draftId);
              return next;
            }),
        },
        queues,
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(worker));
    };
  }, [queues, setParse]);

  React.useEffect(() => {
    if (!loaded || !online || fetch === null) return;
    const now = Date.now();
    for (const draft of draftsRef.current.values()) {
      if (draft.parse._tag !== "Failed" && eligibleForParse(draft, now)) requestParse(draft.id);
    }
  }, [loaded, online, fetch, requestParse]);

  const createDraft = React.useCallback(
    async (input: NewDraft): Promise<ScanDraft> => {
      const id = randomUUID();
      const now = Date.now();
      const photoUri =
        input.capturedPath === null
          ? null
          : await runtime.runPromise(
              DraftStore.use((store) => store.adoptPhoto(id, input.capturedPath ?? "")).pipe(
                Effect.orElseSucceed(() => null),
              ),
            );
      const draft: ScanDraft = {
        id,
        mode: input.mode,
        photoUri,
        recognizedText: input.recognizedText,
        lines: input.lines,
        packs: 1,
        capturedAt: now,
        updatedAt: now,
        parse: input.recognizedText.trim() ? { _tag: "Waiting" } : { _tag: "Manual" },
      };
      writeDraft(draft);
      return draft;
    },
    [writeDraft],
  );

  const setPacks = React.useCallback(
    (draftId: string, packs: number) => {
      const draft = draftsRef.current.get(draftId);
      if (draft && packs >= 1) writeDraft({ ...draft, packs, updatedAt: Date.now() });
    },
    [writeDraft],
  );

  const saveEdits = React.useCallback(
    (draftId: string, edits: ReviewEdits) => {
      const draft = draftsRef.current.get(draftId);
      if (draft && !sameEdits(draft.edits, edits)) {
        writeDraft({ ...draft, edits, updatedAt: Date.now() });
      }
    },
    [writeDraft],
  );

  const removeDraft = React.useCallback(
    (draftId: string) => {
      commitDrafts((current) => {
        const next = new Map(current);
        next.delete(draftId);
        return next;
      });
      runtime.runFork(Effect.ignore(DraftStore.use((store) => store.remove(draftId))));
    },
    [commitDrafts],
  );

  React.useEffect(() => {
    if (lastCommit === null) return;
    const timer = setTimeout(() => setLastCommit(null), 3000);
    return () => clearTimeout(timer);
  }, [lastCommit]);

  const ordered = React.useMemo(
    () => [...drafts.values()].sort((left, right) => right.capturedAt - left.capturedAt),
    [drafts],
  );

  const pausedUntil = React.useMemo(() => {
    let earliest: number | null = null;
    for (const { parse } of drafts.values()) {
      if (parse._tag === "RateLimited" && (earliest === null || parse.retryAt < earliest)) {
        earliest = parse.retryAt;
      }
    }
    return earliest;
  }, [drafts]);

  const value = React.useMemo<ScanDrafts>(
    () => ({
      drafts: ordered,
      loaded,
      parsing,
      pausedUntil,
      online,
      lastCommit,
      createDraft,
      requestParse,
      setPacks,
      setParse,
      saveEdits,
      removeDraft,
      noteCommit: setLastCommit,
    }),
    [
      ordered,
      loaded,
      parsing,
      pausedUntil,
      online,
      lastCommit,
      createDraft,
      requestParse,
      setPacks,
      setParse,
      saveEdits,
      removeDraft,
    ],
  );

  return <ScanDraftsContext value={value}>{children}</ScanDraftsContext>;
}

export const useScanDrafts = (): ScanDrafts => {
  const drafts = React.use(ScanDraftsContext);
  if (drafts === null) throw new Error("Scan drafts are only available inside ScanDraftsProvider.");
  return drafts;
};

export const useScanDraft = (draftId: string | undefined): ScanDraft | null => {
  const { drafts } = useScanDrafts();
  return drafts.find((draft) => draft.id === draftId) ?? null;
};
