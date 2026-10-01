import { RegistryContext, useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { useContext } from "react";

import { toastManager } from "@/components/ui/toast";
import { useWorkspaceStorageKey } from "@/hooks/use-workspace-storage-key";
import { saleDraftsAtom } from "@/lib/preferences";
import {
  canOpenSaleDraft,
  discardSaleDraft,
  draftHasLines,
  MAX_SALE_DRAFTS,
  openSaleDraft,
  parkedSaleCount,
  restoreSaleDraft,
  type SaleDraft,
  type SaleDrafts,
} from "@/lib/sale-drafts";

const UNDO_TIMEOUT = 8_000;

const searchFocusAtom = Atom.make(0).pipe(Atom.keepAlive);

const completingAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive);

const completionToken = (workspace: string, id: number) => `${workspace}:${id}`;

const discardedTitle = (draft: SaleDraft) => {
  const customer = draft.customerName.trim();
  return customer ? `Sale for ${customer} discarded` : `Sale ${draft.ordinal} discarded`;
};

export const saleDraftLimitMessage = `${MAX_SALE_DRAFTS} sales are open. Complete or discard one first.`;

const saleDraftStore = (registry: AtomRegistry.AtomRegistry, workspace: string) => {
  const atom = saleDraftsAtom(workspace);
  const focusSearch = () => registry.update(searchFocusAtom, (count) => count + 1);
  const update = (change: (state: SaleDrafts) => SaleDrafts) => registry.update(atom, change);

  return {
    update,
    focusSearch,
    open: () => {
      const opened = registry.modify(atom, (state) => [
        canOpenSaleDraft(state),
        openSaleDraft(state),
      ]);
      if (!opened) toastManager.add({ title: saleDraftLimitMessage, type: "info" });
      focusSearch();
    },
    discard: (id: number) => {
      if (registry.get(completingAtom).has(completionToken(workspace, id))) return;
      const discarded = registry.modify(atom, (state) => discardSaleDraft(state, id));
      focusSearch();
      if (!discarded || !draftHasLines(discarded.draft)) return;
      const toastId = toastManager.add({
        actionProps: {
          children: "Undo",
          onClick: () => {
            toastManager.close(toastId);
            update((state) => restoreSaleDraft(state, discarded));
            focusSearch();
          },
        },
        timeout: UNDO_TIMEOUT,
        title: discardedTitle(discarded.draft),
      });
    },
    beginCompleting: (id: number) =>
      registry.modify(completingAtom, (tokens) => {
        const token = completionToken(workspace, id);
        return tokens.has(token) ? [false, tokens] : [true, new Set(tokens).add(token)];
      }),
    endCompleting: (id: number) =>
      registry.update(completingAtom, (tokens) => {
        const next = new Set(tokens);
        next.delete(completionToken(workspace, id));
        return next;
      }),
  };
};

export type SaleDraftStore = ReturnType<typeof saleDraftStore>;

export const useSaleDraftsIn = (workspace: string): SaleDrafts =>
  useAtomValue(saleDraftsAtom(workspace));

export const useSaleDraftStoreIn = (workspace: string): SaleDraftStore =>
  saleDraftStore(useContext(RegistryContext), workspace);

export const useSaleDrafts = (): SaleDrafts => useSaleDraftsIn(useWorkspaceStorageKey());

export const useSaleDraftStore = (): SaleDraftStore =>
  useSaleDraftStoreIn(useWorkspaceStorageKey());

export const useSaleSearchFocusRequest = (): number => useAtomValue(searchFocusAtom);

export const useCompletingSaleIn = (workspace: string, id: number): boolean =>
  useAtomValue(completingAtom).has(completionToken(workspace, id));

export const useParkedSaleCountIn = (workspace: string, onNewSale: boolean): number =>
  parkedSaleCount(useSaleDraftsIn(workspace), onNewSale);
