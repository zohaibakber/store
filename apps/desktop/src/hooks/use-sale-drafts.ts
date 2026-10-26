import { useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { StaffState } from "@store/contracts";
import type { InvoiceId } from "@store/contracts/ids";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import {
  useCommand,
  useReadyInventory,
  useStaffState,
  type Inventory,
  type InventoryFailure,
} from "@store/inventory-react";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { useMemo } from "react";

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
import { singleFlight } from "@/lib/single-flight";
import { useWorkspaceStorageKey } from "@/lib/workspace";

const searchFocusAtom = Atom.make(0).pipe(Atom.keepAlive);

const recordedSubject = (draft: SaleDraft) => {
  const customer = draft.customerName.trim();
  return customer ? `The sale for ${customer}` : `Sale ${draft.ordinal}`;
};

export const saleDraftLimitMessage = `${MAX_SALE_DRAFTS} sales are open. Complete or discard one first.`;

const requestSearchFocus = (registry: AtomRegistry.AtomRegistry) =>
  registry.update(searchFocusAtom, (count) => count + 1);

const closeDraft = (registry: AtomRegistry.AtomRegistry, owner: SaleDraftOwner, id: InvoiceId) => {
  const atom = saleDraftsAtom(owner);
  const next = closeSaleDraft(registry.get(atom), id, newSaleId());
  registry.set(atom, () => next);
  return hasHeldSale(next);
};

const completingSale = Atom.family((id: InvoiceId) =>
  singleFlight(
    Atom.fn<{
      readonly owner: SaleDraftOwner;
      readonly sale: (finish: SaleFinish) => Promise<void>;
    }>()(
      Effect.fn("SaleDrafts.complete")(function* ({ owner, sale }, get) {
        yield* Effect.promise(() =>
          sale({
            close: () => closeDraft(get.registry, owner, id),
            focusSearch: () => requestSearchFocus(get.registry),
          }),
        );
      }),
    ),
  ),
);

export type SaleFinish = {
  readonly close: () => boolean;
  readonly focusSearch: () => void;
};

const isCompleting = (get: Atom.AtomContext, id: InvoiceId) =>
  AsyncResult.isWaiting(get(completingSale(id)));

const openDraft = Atom.fnSync<SaleDraftOwner>()((owner, get) => {
  const atom = saleDraftsAtom(owner);
  if (!canOpenSaleDraft(get.registry.get(atom))) {
    toastManager.add({ title: saleDraftLimitMessage, type: "info" });
  }
  get.set(atom, (state) => openSaleDraft(state, newSaleId()));
  requestSearchFocus(get.registry);
}).pipe(Atom.keepAlive);

const completeSale = Atom.fnSync<{
  readonly owner: SaleDraftOwner;
  readonly id: InvoiceId;
  readonly sale: (finish: SaleFinish) => Promise<void>;
}>()(({ owner, id, sale }, get) => get.set(completingSale(id), { owner, sale })).pipe(
  Atom.keepAlive,
);

const discardDraft = Atom.fnSync<{
  readonly owner: SaleDraftOwner;
  readonly id: InvoiceId;
}>()(({ owner, id }, get) => {
  if (AsyncResult.isWaiting(get.registry.get(completingSale(id)))) return;
  closeDraft(get.registry, owner, id);
  requestSearchFocus(get.registry);
}).pipe(Atom.keepAlive);

export const clearSaleDrafts = Atom.fnSync<string>()((workspace, get) => {
  for (const atom of storedSaleDraftAtoms(workspace)) {
    get.set(atom, () => initialSaleDrafts(newSaleId()));
  }
}).pipe(Atom.keepAlive);

const releaseSaleDraftsAtom = Atom.fn<string>()((workspace, get) =>
  Effect.sync(() => {
    const [unowned, ...members] = storedSaleDraftAtoms(workspace);
    if (unowned === undefined) return 0;
    let dropped = 0;
    for (const member of members) {
      for (const draft of heldSaleDrafts(get.registry.get(member))) {
        get.set(unowned, (state) => receiveSaleDraft(state, draft));
        if (!get.registry.get(unowned).drafts.some((open) => open.id === draft.id)) dropped += 1;
      }
      get.set(member, () => initialSaleDrafts(newSaleId()));
    }
    return dropped;
  }),
).pipe(Atom.keepAlive);

const droppedIssuedDrafts = (
  draftsAtom: ReturnType<typeof saleDraftsAtom>,
  atoms: Inventory["atoms"],
) =>
  Atom.make((get) => {
    const { drafts } = get(draftsAtom);
    const issued = AsyncResult.value(get(atoms.issuedInvoices(drafts.map((open) => open.id))));
    if (Option.isNone(issued)) return;
    for (const invoice of issued.value) {
      const closed = drafts.find((open) => open.id === invoice.id);
      if (closed === undefined || isCompleting(get, invoice.id)) continue;
      get.set(draftsAtom, (state) => closeSaleDraft(state, invoice.id, newSaleId()));
      toastManager.add({
        title: `${recordedSubject(closed)} was already recorded as invoice #${formatInvoiceNumber(invoice.invoiceNumber)}`,
        type: "info",
      });
    }
  });

const NO_DROPS = Atom.make(undefined);

export const useDropIssuedSaleDrafts = (owner: SaleDraftOwner) => {
  const atoms = useReadyInventory()?.inventory.atoms;
  const draftsAtom = saleDraftsAtom(owner);
  const dropping = useMemo(
    () => (atoms === undefined ? NO_DROPS : droppedIssuedDrafts(draftsAtom, atoms)),
    [atoms, draftsAtom],
  );
  useAtomMount(dropping);
};

const NO_STAFF: Atom.Atom<Option.Option<StaffState>> = Atom.make(Option.none<StaffState>());

export const useSaleDraftOwner = (): SaleDraftOwner => {
  const staff = useAtomValue(useReadyInventory()?.inventory.atoms.staff ?? NO_STAFF);
  return saleDraftOwner(useWorkspaceStorageKey(), Option.getOrUndefined(staff));
};

export const useSaleDraftsIn = (owner: SaleDraftOwner): SaleDrafts =>
  useAtomValue(saleDraftsAtom(owner));

export const useSaleDraftActions = (owner: SaleDraftOwner) => {
  const setDrafts = useAtomSet(saleDraftsAtom(owner));
  const open = useAtomSet(openDraft);
  const discard = useAtomSet(discardDraft);
  const complete = useAtomSet(completeSale);
  const setSearchFocus = useAtomSet(searchFocusAtom);
  return {
    update: (change: (state: SaleDrafts) => SaleDrafts) => setDrafts(() => change),
    focusSearch: () => setSearchFocus((count) => count + 1),
    open: () => open(owner),
    discard: (id: InvoiceId) => discard({ owner, id }),
    complete: (id: InvoiceId, sale: (finish: SaleFinish) => Promise<void>) =>
      complete({ owner, id, sale }),
  };
};

export const useSaleDraftActionsHere = () => useSaleDraftActions(useSaleDraftOwner());

export const useClearSaleDrafts = () => {
  const clear = useAtomSet(clearSaleDrafts);
  const workspace = useWorkspaceStorageKey();
  return () => clear(workspace);
};

export const useReleaseSaleDrafts = () => {
  const release = useAtomSet(releaseSaleDraftsAtom, { mode: "promise" });
  const workspace = useWorkspaceStorageKey();
  return () => release(workspace);
};

export const useSaleSearchFocusRequest = (): number => useAtomValue(searchFocusAtom);

export const useCompletingSale = (id: InvoiceId): boolean =>
  AsyncResult.isWaiting(useAtomValue(completingSale(id)));

export const useParkedSaleCount = (onNewSale: boolean): number =>
  parkedSaleCount(useSaleDraftsIn(useSaleDraftOwner()), onNewSale);

export type ParkedElsewhere = {
  readonly owner: SaleDraftMember;
  readonly drafts: ReadonlyArray<SaleDraft>;
};

type SaleDraftMove = {
  readonly id: InvoiceId;
  readonly from: SaleDraftMember;
  readonly to: SaleDraftOwner;
  readonly handOver: () => Promise<Exit.Exit<void, InventoryFailure>>;
};

const takeOverSaleDraft = Atom.fn<SaleDraftMove>()(
  Effect.fn("SaleDrafts.takeOver")(function* (move, get) {
    const source = saleDraftsAtom(move.from);
    const target = saleDraftsAtom(move.to);
    const parked = () =>
      heldSaleDrafts(get.registry.get(source)).find((draft) => draft.id === move.id);
    const holds = () => get.registry.get(target).drafts.some((draft) => draft.id === move.id);

    if (parked() === undefined) {
      toastManager.add({ title: "That sale is no longer parked.", type: "info" });
      return false;
    }
    if (!canOpenSaleDraft(get.registry.get(target))) {
      toastManager.add({ title: saleDraftLimitMessage, type: "info" });
      return false;
    }
    const exit = yield* Effect.promise(move.handOver);
    if (Exit.isFailure(exit)) {
      toastManager.add({ title: failureMessage(exit.cause), type: "error" });
      return false;
    }
    const draft = parked();
    if (draft === undefined) return holds();
    get.set(target, (state) => receiveSaleDraft(state, draft));
    if (!holds()) {
      toastManager.add({ title: saleDraftLimitMessage, type: "info" });
      return false;
    }
    get.set(source, (state) => closeSaleDraft(state, move.id, newSaleId()));
    toastManager.add({
      title: `${saleDraftLabel(draft)} taken over from ${move.from.member.name}`,
      type: "success",
    });
    requestSearchFocus(get.registry);
    return true;
  }),
  { concurrent: true },
).pipe(Atom.keepAlive);

export const useParkedElsewhere = () => {
  const takeOverDraft = useAtomSet(takeOverSaleDraft, { mode: "promise" });
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
    takeOver: (from: SaleDraftMember, id: InvoiceId) =>
      takeOverDraft({
        id,
        from,
        to: owner,
        handOver: () => handOverDraft({ draftId: id, from: from.member.id }),
      }),
  };
};
