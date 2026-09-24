import { formatExpiry, parseExpiry } from "./expiry";
import {
  type CommitPlan,
  type MatchedProduct,
  deriveFieldFlags,
  needsCheck,
  planCommit,
  reviewValuesWith,
} from "./fields";
import { LOW_CONFIDENCE, type ScanDraft, isAwaitingParse } from "./model";

export type DraftStatus = "ready" | "check" | "reading";

export const draftStatus = (
  draft: ScanDraft,
  inFlight: boolean,
  matched: boolean | null,
): DraftStatus => {
  const { parse } = draft;
  if (inFlight || isAwaitingParse(parse)) return "reading";
  if (parse._tag !== "Parsed") return "check";
  if (matched === null) return parse.result.confidence < LOW_CONFIDENCE ? "check" : "ready";
  return needsCheck(deriveFieldFlags(parse.result, draft.recognizedText), parse.result, matched)
    ? "check"
    : "ready";
};

export type StatusCounts = { readonly [Status in DraftStatus]: number };

export const countStatuses = (statuses: Iterable<DraftStatus>): StatusCounts => {
  const counts = { ready: 0, check: 0, reading: 0 };
  for (const status of statuses) counts[status] += 1;
  return counts;
};

export const statusSummary = (counts: StatusCounts): string =>
  [
    counts.ready > 0 ? `${counts.ready} ready` : null,
    counts.check > 0 ? `${counts.check} to check` : null,
    counts.reading > 0 ? `${counts.reading} still reading` : null,
  ]
    .filter((part) => part !== null)
    .join(", ") || "Nothing scanned yet";

export const draftTitle = (draft: ScanDraft): string => {
  const edited = draft.edits?.name?.trim();
  if (edited) return edited;
  if (draft.parse._tag === "Parsed" && draft.parse.result.name) return draft.parse.result.name;
  return draft.lines[0] ?? "Typed entry";
};

export const draftSubtitle = (draft: ScanDraft, now: number): string => {
  const { parse } = draft;
  switch (parse._tag) {
    case "Waiting":
      return "Reading the label";
    case "Deferred":
      return "Auto-fills when you're back online";
    case "RateLimited": {
      const seconds = Math.max(0, Math.ceil((parse.retryAt - now) / 1000));
      return seconds > 0 ? `Auto-fill paused · ${seconds} s` : "Auto-fill resumes shortly";
    }
    case "Failed":
      return parse.reason;
    case "Manual":
      return "Fill in by hand";
    case "Parsed": {
      const expiry = parse.result.expiresAt === null ? null : parseExpiry(parse.result.expiresAt);
      return (
        [
          parse.result.batchNumber === null ? null : `Batch ${parse.result.batchNumber}`,
          expiry === null ? null : `Exp ${formatExpiry(expiry)}`,
        ]
          .filter((part) => part !== null)
          .join(" · ") || "No batch details found"
      );
    }
  }
};

export const countdownSeconds = (until: number | null, now: number): number =>
  until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));

export type BatchRow = {
  readonly status: DraftStatus;
  readonly plan: Exclude<CommitPlan, { readonly _tag: "Invalid" }> | null;
};

export const batchRow = (
  draft: ScanDraft,
  inFlight: boolean,
  match: MatchedProduct | null,
): BatchRow => {
  const status = draftStatus(draft, inFlight, match !== null);
  if (status !== "ready" || draft.parse._tag !== "Parsed") return { status, plan: null };
  const plan = planCommit(
    match === null ? "newProduct" : "addBatch",
    reviewValuesWith(draft.parse.result, draft.edits),
    draft.packs,
    match,
  );
  return plan._tag === "Invalid" ? { status: "check", plan: null } : { status, plan };
};
