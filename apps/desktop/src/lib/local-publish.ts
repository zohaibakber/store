import { RegistryContext, useAtom, useAtomValue } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { use } from "react";

import { toastManager } from "@/components/ui/toast";
import { appHost } from "@/host";
import { useAuth } from "@/lib/auth";
import { storeErrorMessage, toastStoreError } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import { useCatalogIsEmpty } from "@/lib/inventory/catalog-empty";
import { publishOfferDismissedAtom } from "@/lib/preferences";
import type { CatalogCounts } from "@/lib/workspace-backup";
import type { PublishOffer, PublishProgress } from "@/lib/workspace-publish";
import { witnessBoundLocalCatalog } from "@/session/workspace-session";

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

const NO_OFFER: PublishOffer = { _tag: "none" };

const IDLE: PublishPhase = { _tag: "Idle" };

const offerAtom = Atom.family((organizationId: string) =>
  Atom.make(
    Effect.tryPromise(
      () => appHost().publish?.offer(organizationId) ?? Promise.resolve(NO_OFFER),
    ).pipe(Effect.orElseSucceed(() => NO_OFFER)),
  ),
);

const phaseAtom = Atom.family((_organizationId: string) =>
  Atom.make<PublishPhase>(IDLE).pipe(Atom.keepAlive),
);

const movingAtom = Atom.make(false).pipe(Atom.keepAlive);

const ANOTHER_ORGANIZATION = "another organization";

export const catalogContents = (counts: CatalogCounts) =>
  `${formatCount(counts.products, "product")} and ${formatCount(counts.sales, "sale")}`;

export const moveLocalWorkspace = (
  registry: AtomRegistry.AtomRegistry,
  organization: PublishTarget,
) => {
  const bridge = appHost().publish;
  const phase = phaseAtom(organization.id);
  if (!bridge || registry.get(movingAtom)) return;
  registry.set(movingAtom, true);
  registry.set(phase, { _tag: "Moving", progress: null });
  const stop = bridge.onProgress((progress) => registry.set(phase, { _tag: "Moving", progress }));
  void bridge
    .publish(organization.id)
    .then(
      (outcome) => {
        switch (outcome._tag) {
          case "published":
            registry.set(phase, IDLE);
            registry.refresh(offerAtom(organization.id));
            toastManager.add({
              title: `Moved to ${organization.name}`,
              description: `${catalogContents(outcome.counts)} from this device now sync with ${organization.name}.`,
              type: "success",
            });
            void witnessBoundLocalCatalog("empty").catch(() => undefined);
            return;
          case "failed":
            registry.set(phase, { _tag: "Failed", message: outcome.message });
            return;
        }
      },
      (cause) => registry.set(phase, { _tag: "Failed", message: storeErrorMessage(cause) }),
    )
    .finally(() => {
      stop();
      registry.set(movingAtom, false);
    });
};

export const cancelMoveElsewhere = (
  registry: AtomRegistry.AtomRegistry,
  organization: PublishTarget,
) => {
  const bridge = appHost().publish;
  if (!bridge || registry.get(movingAtom)) return;
  void bridge
    .discard(organization.id)
    .catch(toastStoreError)
    .finally(() => registry.refresh(offerAtom(organization.id)));
};

export const usePublishInProgress = (): boolean => useAtomValue(movingAtom);

export const usePublishTarget = (): PublishTarget | null => {
  const { workspace, workspaces } = useAuth();
  if (appHost().publish === undefined || workspace._tag !== "Organization") return null;
  if (workspace.organization.role !== "owner") return null;
  if (!workspaces.some((open) => open._tag === "Local")) return null;
  return workspace.organization;
};

export const useLocalPublish = (organization: PublishTarget) => {
  const registry = use(RegistryContext);
  const offer = Option.getOrElse(
    AsyncResult.value(useAtomValue(offerAtom(organization.id))),
    () => NO_OFFER,
  );
  const phase = useAtomValue(phaseAtom(organization.id));
  const organizationIsEmpty = useCatalogIsEmpty();
  const organizations = useAuth().snapshot?.organizations ?? [];
  const move = () => moveLocalWorkspace(registry, organization);
  const cancelElsewhere = () => cancelMoveElsewhere(registry, organization);
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
