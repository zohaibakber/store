import { useAtom, useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useSuspenseCatalogHoldsNothing } from "@store/inventory-react";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";
import { useMemo } from "react";

import { toastManager } from "@/components/ui/toast";
import { clearSaleDrafts } from "@/hooks/use-sale-drafts";
import { appHost } from "@/host";
import type { CatalogCounts } from "@/host/workspace-backup";
import type { PublishOffer, PublishOutcome, PublishProgress } from "@/host/workspace-publish";
import { useAuth } from "@/lib/auth";
import { catalogContents } from "@/lib/catalog-counts";
import { bridgeMessage, toastBridgeFailure } from "@/lib/errors";
import { publishOfferDismissedAtom } from "@/lib/preferences";
import { singleFlight } from "@/lib/single-flight";
import { workspaceStorageKey } from "@/lib/workspace";
import { witnessLocalCatalog } from "@/session/workspace-session";

export type PublishTarget = { readonly id: string; readonly name: string };

type PublishPhase =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Moving"; readonly progress: PublishProgress | null }
  | { readonly _tag: "Failed"; readonly message: string };

export type LocalPublish =
  | { readonly _tag: "Nothing" }
  | { readonly _tag: "Offered"; readonly counts: CatalogCounts; readonly resuming: boolean }
  | { readonly _tag: "Occupied"; readonly counts: CatalogCounts }
  | { readonly _tag: "Elsewhere"; readonly counts: CatalogCounts; readonly destination: string }
  | { readonly _tag: "Moving"; readonly progress: PublishProgress | null }
  | { readonly _tag: "Failed"; readonly message: string };

type PublishRun = { readonly organizationId: string; readonly outcome: PublishOutcome };

const NO_OFFER: PublishOffer = { _tag: "none" };

const IDLE: PublishPhase = { _tag: "Idle" };

const ANOTHER_ORGANIZATION = "another organization";

const offerAtom = Atom.family((organizationId: string) =>
  Atom.make(
    Effect.tryPromise(() => appHost().publish.offer(organizationId)).pipe(
      Effect.orElseSucceed(() => NO_OFFER),
    ),
  ),
);

const progressAtom = Atom.make(
  Stream.callback<PublishProgress>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        appHost().publish.onProgress((progress) => Queue.offerUnsafe(queue, progress)),
      ),
      (stop) => Effect.sync(stop),
    ),
  ),
);

const failedMove = (cause: unknown): PublishOutcome => ({
  _tag: "failed",
  message: bridgeMessage(cause),
});

const moveToOrganization = Atom.fn<PublishTarget>()(
  Effect.fn("LocalPublish.move")(function* (organization, get) {
    const outcome = yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Atom.mount(progressAtom);
        return yield* Effect.tryPromise({
          try: () => appHost().publish.publish(organization.id),
          catch: (cause) => cause,
        }).pipe(Effect.match({ onSuccess: (published) => published, onFailure: failedMove }));
      }),
    );
    if (outcome._tag === "published") {
      get.refresh(offerAtom(organization.id));
      get.set(clearSaleDrafts, workspaceStorageKey({ _tag: "Local" }));
      toastManager.add({
        title: `Moved to ${organization.name}`,
        description: `${catalogContents(outcome.counts)} from this device now sync with ${organization.name}.`,
        type: "success",
      });
      get.set(witnessLocalCatalog, "empty");
    }
    return { organizationId: organization.id, outcome } satisfies PublishRun;
  }),
);

const moveAtom = singleFlight(moveToOrganization);

const discardElsewhere = Atom.fn<PublishTarget>()(
  Effect.fn("LocalPublish.discard")(function* (organization, get) {
    yield* Effect.tryPromise({
      try: () => appHost().publish.discard(organization.id),
      catch: (cause) => cause,
    }).pipe(
      Effect.tapError((cause) => Effect.sync(() => toastBridgeFailure(cause))),
      Effect.ignore,
      Effect.ensuring(Effect.sync(() => get.refresh(offerAtom(organization.id)))),
    );
  }),
).pipe(Atom.keepAlive);

const phaseAtom = Atom.family((organizationId: string) =>
  Atom.make((get): PublishPhase => {
    const run = get(moveAtom);
    if (AsyncResult.isWaiting(run)) {
      return { _tag: "Moving", progress: Option.getOrNull(AsyncResult.value(get(progressAtom))) };
    }
    return Option.match(AsyncResult.value(run), {
      onNone: () => IDLE,
      onSome: (last): PublishPhase =>
        last.organizationId === organizationId && last.outcome._tag === "failed"
          ? { _tag: "Failed", message: last.outcome.message }
          : IDLE,
    });
  }),
);

const resume = Effect.fn("LocalPublish.resume")(function* (
  get: Atom.AtomContext,
  organization: PublishTarget,
  interrupted: boolean,
) {
  if (interrupted) yield* Effect.sync(() => get.set(moveAtom, organization));
});

const resumeInterrupted = (organization: PublishTarget) => {
  const phase = phaseAtom(organization.id);
  return Atom.make((get) => {
    const offer = AsyncResult.value(get(offerAtom(organization.id)));
    const interrupted =
      get(phase)._tag === "Idle" &&
      Option.isSome(offer) &&
      offer.value._tag === "available" &&
      offer.value.resuming;
    return resume(get, organization, interrupted);
  });
};

export const usePublishInProgress = (): boolean => AsyncResult.isWaiting(useAtomValue(moveAtom));

export const usePublishTarget = (): PublishTarget | null => {
  const { workspace, workspaces } = useAuth();
  if (workspace._tag !== "Organization") return null;
  if (workspace.organization.role !== "owner") return null;
  if (!workspaces.some((open) => open._tag === "Local")) return null;
  return workspace.organization;
};

export const useResumeInterruptedPublish = (organization: PublishTarget) => {
  const resume = useMemo(() => resumeInterrupted(organization), [organization]);
  useAtomMount(resume);
};

export const useLocalPublish = (organization: PublishTarget) => {
  const offer = Option.getOrElse(
    AsyncResult.value(useAtomValue(offerAtom(organization.id))),
    () => NO_OFFER,
  );
  const phase = useAtomValue(phaseAtom(organization.id));
  const organizationIsEmpty = useSuspenseCatalogHoldsNothing();
  const organizations = useAuth().snapshot?.organizations ?? [];
  const publishing = usePublishInProgress();
  const startMove = useAtomSet(moveAtom);
  const startDiscard = useAtomSet(discardElsewhere);
  const move = () => startMove(organization);
  const cancelElsewhere = () => {
    if (!publishing) startDiscard(organization);
  };
  const state = ((): LocalPublish => {
    switch (phase._tag) {
      case "Moving":
      case "Failed":
        return phase;
      case "Idle":
        switch (offer._tag) {
          case "none":
            return { _tag: "Nothing" };
          case "available":
            return organizationIsEmpty || offer.resuming
              ? { _tag: "Offered", counts: offer.counts, resuming: offer.resuming }
              : { _tag: "Occupied", counts: offer.counts };
          case "elsewhere":
            return organizationIsEmpty
              ? {
                  _tag: "Elsewhere",
                  counts: offer.counts,
                  destination:
                    organizations.find((other) => other.id === offer.organizationId)?.name ??
                    ANOTHER_ORGANIZATION,
                }
              : { _tag: "Occupied", counts: offer.counts };
        }
    }
  })();
  return { state, move, cancelElsewhere };
};

export const usePublishOfferDismissal = (organization: PublishTarget) => {
  const [dismissed, setDismissed] = useAtom(publishOfferDismissedAtom);
  return {
    dismissed: dismissed.includes(organization.id),
    dismiss: () =>
      setDismissed((current) =>
        current.includes(organization.id) ? current : [...current, organization.id],
      ),
  };
};
