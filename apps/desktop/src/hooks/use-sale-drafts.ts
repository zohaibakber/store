import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { InvoiceId } from "@store/contracts/ids";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import * as Option from "effect/Option";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { useContext } from "react";

import { toastManager } from "@/components/ui/toast";
import { useWorkspaceStorageKey } from "@/hooks/use-workspace-storage-key";
import { newSaleId, saleDraftsAtom } from "@/lib/preferences";
import {
  canOpenSaleDraft,
  closeSaleDraft,
  hasHeldSale,
  initialSaleDrafts,
  MAX_SALE_DRAFTS,
  openSaleDraft,
  parkedSaleCount,
  type SaleDraft,
  type SaleDrafts,
} from "@/lib/sale-drafts";

const searchFocusAtom = Atom.make(0).pipe(Atom.keepAlive);

const completingAtom = Atom.make<ReadonlySet<InvoiceId>>(new Set<InvoiceId>()).pipe(Atom.keepAlive);

const recordedSubject = (draft: SaleDraft) => {
  const customer = draft.customerName.trim();
  return customer ? `The sale for ${customer}` : `Sale ${draft.ordinal}`;
};

export const saleDraftLimitMessage = `${MAX_SALE_DRAFTS} sales are open. Complete or discard one first.`;

export type IssuedSale = { readonly id: InvoiceId; readonly invoiceNumber: number };

export const saleDraftStore = (registry: AtomRegistry.AtomRegistry, workspace: string) => {
  const atom = saleDraftsAtom(workspace);
  const focusSearch = () => registry.update(searchFocusAtom, (count) => count + 1);
  const update = (change: (state: SaleDrafts) => SaleDrafts) => registry.set(atom, change);

  const modify = <A>(change: (state: SaleDrafts) => readonly [result: A, next: SaleDrafts]): A => {
    let outcome: Option.Option<A> = Option.none();
    update((state) => {
      const [result, next] = change(state);
      outcome = Option.some(result);
      return next;
    });
    return Option.getOrThrow(outcome);
  };

  const close = (id: InvoiceId) =>
    modify((state) => {
      const open = state.drafts.find((draft) => draft.id === id);
      const next = closeSaleDraft(state, id, newSaleId());
      return [{ closed: open, held: hasHeldSale(next) }, next];
    });

  return {
    update,
    focusSearch,
    open: () => {
      const opened = modify((state) => [
        canOpenSaleDraft(state),
        openSaleDraft(state, newSaleId()),
      ]);
      if (!opened) toastManager.add({ title: saleDraftLimitMessage, type: "info" });
      focusSearch();
    },
    discard: (id: InvoiceId) => {
      if (registry.get(completingAtom).has(id)) return;
      close(id);
      focusSearch();
    },
    complete: (id: InvoiceId) => close(id).held,
    dropIssued: (issued: ReadonlyArray<IssuedSale>) => {
      const completing = registry.get(completingAtom);
      for (const invoice of issued) {
        if (completing.has(invoice.id)) continue;
        const { closed } = close(invoice.id);
        if (!closed) continue;
        toastManager.add({
          title: `${recordedSubject(closed)} was already recorded as invoice #${formatInvoiceNumber(invoice.invoiceNumber)}`,
          type: "info",
        });
      }
    },
    clear: () => update(() => initialSaleDrafts(newSaleId())),
    whileCompleting: async (id: InvoiceId, sale: () => Promise<void>) => {
      const begun = registry.modify(completingAtom, (ids) =>
        ids.has(id) ? [false, ids] : [true, new Set(ids).add(id)],
      );
      if (!begun) return;
      try {
        await sale();
      } finally {
        registry.update(completingAtom, (ids) => new Set([...ids].filter((open) => open !== id)));
      }
    },
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

export const useCompletingSale = (id: InvoiceId): boolean => useAtomValue(completingAtom).has(id);

export const useParkedSaleCountIn = (workspace: string, onNewSale: boolean): number =>
  parkedSaleCount(useSaleDraftsIn(workspace), onNewSale);
