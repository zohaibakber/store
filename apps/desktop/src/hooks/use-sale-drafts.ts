import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { StaffState } from "@store/contracts";
import type { InvoiceId } from "@store/contracts/ids";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import {
  useCommand,
  useReadyInventory,
  useStaffState,
  type InventoryFailure,
} from "@store/inventory-react";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { useContext, useMemo } from "react";

import { toastManager } from "@/components/ui/toast";
import { failureMessage } from "@/lib/errors";
import { newSaleId, saleDraftsAtom, storedSaleDraftAtoms } from "@/lib/preferences";
import {
  canOpenSaleDraft,
  closeSaleDraft,
  hasHeldSale,
  heldSaleDrafts,
  initialSaleDrafts,
  MAX_SALE_DRAFTS,
  openSaleDraft,
  otherSaleDraftOwners,
  parkedSaleCount,
  receiveSaleDraft,
  saleDraftLabel,
  saleDraftOwner,
  type SaleDraft,
  type SaleDraftMember,
  type SaleDraftOwner,
  type SaleDrafts,
} from "@/lib/sale-drafts";
import { useWorkspaceStorageKey } from "@/lib/workspace";

const searchFocusAtom = Atom.make(0).pipe(Atom.keepAlive);

const completingAtom = Atom.make<ReadonlySet<InvoiceId>>(new Set<InvoiceId>()).pipe(Atom.keepAlive);

const recordedSubject = (draft: SaleDraft) => {
  const customer = draft.customerName.trim();
  return customer ? `The sale for ${customer}` : `Sale ${draft.ordinal}`;
};

export const saleDraftLimitMessage = `${MAX_SALE_DRAFTS} sales are open. Complete or discard one first.`;

type IssuedSale = { readonly id: InvoiceId; readonly invoiceNumber: number };

export const saleDraftStore = (registry: AtomRegistry.AtomRegistry, owner: SaleDraftOwner) => {
  const atom = saleDraftsAtom(owner);
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

type SaleDraftStore = ReturnType<typeof saleDraftStore>;

export const clearSaleDrafts = (registry: AtomRegistry.AtomRegistry, workspace: string) => {
  for (const atom of storedSaleDraftAtoms(workspace)) {
    registry.set(atom, () => initialSaleDrafts(newSaleId()));
  }
};

export const releaseSaleDrafts = (registry: AtomRegistry.AtomRegistry, workspace: string) => {
  const [unowned, ...members] = storedSaleDraftAtoms(workspace);
  if (unowned === undefined) return 0;
  let dropped = 0;
  for (const member of members) {
    for (const draft of heldSaleDrafts(registry.get(member))) {
      registry.set(unowned, (state) => receiveSaleDraft(state, draft));
      if (!registry.get(unowned).drafts.some((open) => open.id === draft.id)) dropped += 1;
    }
    registry.set(member, () => initialSaleDrafts(newSaleId()));
  }
  return dropped;
};

const NO_STAFF: Atom.Atom<Option.Option<StaffState>> = Atom.make(Option.none<StaffState>());

export const useSaleDraftOwner = (): SaleDraftOwner => {
  const staff = useAtomValue(useReadyInventory()?.inventory.atoms.staff ?? NO_STAFF);
  return saleDraftOwner(useWorkspaceStorageKey(), Option.getOrUndefined(staff));
};

export const useSaleDraftsIn = (owner: SaleDraftOwner): SaleDrafts =>
  useAtomValue(saleDraftsAtom(owner));

export const useSaleDraftStoreIn = (owner: SaleDraftOwner): SaleDraftStore =>
  saleDraftStore(useContext(RegistryContext), owner);

export const useSaleDraftStore = (): SaleDraftStore => useSaleDraftStoreIn(useSaleDraftOwner());

export const useClearSaleDrafts = () => {
  const registry = useContext(RegistryContext);
  const workspace = useWorkspaceStorageKey();
  return () => clearSaleDrafts(registry, workspace);
};

export const useReleaseSaleDrafts = () => {
  const registry = useContext(RegistryContext);
  const workspace = useWorkspaceStorageKey();
  return () => releaseSaleDrafts(registry, workspace);
};

export const useSaleSearchFocusRequest = (): number => useAtomValue(searchFocusAtom);

export const useCompletingSale = (id: InvoiceId): boolean => useAtomValue(completingAtom).has(id);

export const useParkedSaleCount = (onNewSale: boolean): number =>
  parkedSaleCount(useSaleDraftsIn(useSaleDraftOwner()), onNewSale);

export type ParkedElsewhere = {
  readonly owner: SaleDraftMember;
  readonly drafts: ReadonlyArray<SaleDraft>;
};

const takeOverSaleDraft = async (
  registry: AtomRegistry.AtomRegistry,
  move: {
    readonly id: InvoiceId;
    readonly from: SaleDraftMember;
    readonly to: SaleDraftOwner;
    readonly handOver: () => Promise<Exit.Exit<void, InventoryFailure>>;
  },
): Promise<boolean> => {
  const source = saleDraftsAtom(move.from);
  const target = saleDraftsAtom(move.to);
  const parked = () => heldSaleDrafts(registry.get(source)).find((draft) => draft.id === move.id);
  const holds = () => registry.get(target).drafts.some((draft) => draft.id === move.id);

  if (parked() === undefined) {
    toastManager.add({ title: "That sale is no longer parked.", type: "info" });
    return false;
  }
  if (!canOpenSaleDraft(registry.get(target))) {
    toastManager.add({ title: saleDraftLimitMessage, type: "info" });
    return false;
  }
  const exit = await move.handOver();
  if (Exit.isFailure(exit)) {
    toastManager.add({ title: failureMessage(exit.cause), type: "error" });
    return false;
  }
  const draft = parked();
  if (draft === undefined) return holds();
  registry.set(target, (state) => receiveSaleDraft(state, draft));
  if (!holds()) {
    toastManager.add({ title: saleDraftLimitMessage, type: "info" });
    return false;
  }
  registry.set(source, (state) => closeSaleDraft(state, move.id, newSaleId()));
  toastManager.add({
    title: `${saleDraftLabel(draft)} taken over from ${move.from.member.name}`,
    type: "success",
  });
  return true;
};

export const useParkedElsewhere = () => {
  const registry = useContext(RegistryContext);
  const staff = useStaffState();
  const [handOverDraft] = useCommand((commands) => commands.staff.handOverDraft);
  const workspace = useWorkspaceStorageKey();
  const owner = saleDraftOwner(workspace, staff);
  const parkedAtom = useMemo(() => {
    const others = otherSaleDraftOwners(workspace, staff);
    return Atom.make((get): ReadonlyArray<ParkedElsewhere> =>
      others
        .map((other) => ({ owner: other, drafts: heldSaleDrafts(get(saleDraftsAtom(other))) }))
        .filter((held) => held.drafts.length > 0),
    );
  }, [workspace, staff]);

  return {
    parked: useAtomValue(parkedAtom),
    takeOver: async (from: SaleDraftMember, id: InvoiceId) => {
      const moved = await takeOverSaleDraft(registry, {
        id,
        from,
        to: owner,
        handOver: () => handOverDraft({ draftId: id, from: from.member.id }),
      });
      if (moved) registry.update(searchFocusAtom, (count) => count + 1);
      return moved;
    },
  };
};
