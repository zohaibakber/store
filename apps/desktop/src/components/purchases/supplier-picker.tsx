import { PlusSignCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Supplier } from "@store/contracts";
import * as React from "react";

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSeparator,
} from "@/components/ui/combobox";
import { toastManager } from "@/components/ui/toast";
import { useStoreCommand } from "@/hooks/use-store-command";
import { useInventoryActions } from "@/lib/inventory";

type SupplierOption = {
  readonly id: string;
  readonly name: string;
  readonly create?: boolean;
};

export function SupplierPicker({
  canCreate = true,
  disabled = false,
  label,
  onChange,
  placeholder = "Choose a supplier…",
  suppliers,
  value,
}: {
  readonly canCreate?: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onChange: (supplierId: Supplier["id"]) => void;
  readonly placeholder?: string;
  readonly suppliers: ReadonlyArray<Supplier>;
  readonly value: Supplier["id"] | null;
}) {
  const { saveSupplier } = useInventoryActions();
  const [query, setQuery] = React.useState("");
  const [pending, run] = useStoreCommand();

  const term = query.trim();
  const lowered = term.toLocaleLowerCase();
  const selected: SupplierOption | null =
    suppliers.find((supplier) => supplier.id === value) ?? null;
  const matches: ReadonlyArray<SupplierOption> = term
    ? suppliers.filter((supplier) => supplier.name.toLocaleLowerCase().includes(lowered))
    : suppliers;
  const exists = suppliers.some((supplier) => supplier.name.trim().toLocaleLowerCase() === lowered);
  const offersCreate = canCreate && term.length > 0 && !exists;
  const options: ReadonlyArray<SupplierOption> = offersCreate
    ? [...matches, { id: `create:${term}`, name: term, create: true }]
    : matches;

  const select = async (option: SupplierOption | null) => {
    if (!option) return;
    if (!option.create) {
      const supplier = suppliers.find((entry) => entry.id === option.id);
      if (supplier) onChange(supplier.id);
      return;
    }
    await run(async () => {
      const supplier = await saveSupplier({ name: option.name });
      onChange(supplier.id);
      toastManager.add({ title: `${supplier.name} added`, type: "success" });
    }, "Could not add the supplier.");
  };

  return (
    <Combobox
      autoHighlight
      disabled={disabled || pending}
      filter={null}
      isItemEqualToValue={(item: SupplierOption, current: SupplierOption) => item.id === current.id}
      items={[...options]}
      itemToStringLabel={(item: SupplierOption) => item.name}
      itemToStringValue={(item: SupplierOption) => item.id}
      onInputValueChange={(next: string, details: { reason?: string }) => {
        if (details.reason === "item-press") return;
        setQuery(next);
      }}
      onValueChange={(option: SupplierOption | null) => {
        setQuery("");
        void select(option);
      }}
      value={selected}
    >
      <ComboboxInput
        aria-label={label}
        className="w-full"
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        placeholder={selected ? selected.name : placeholder}
        size="sm"
      />
      <ComboboxPopup>
        <ComboboxEmpty>
          {canCreate ? "Type a name to add a supplier." : "No suppliers found."}
        </ComboboxEmpty>
        <ComboboxList>
          {(option: SupplierOption) =>
            option.create ? (
              <React.Fragment key="create">
                {matches.length > 0 ? <ComboboxSeparator /> : null}
                <ComboboxItem value={option}>
                  <span className="flex min-w-0 items-center gap-2">
                    <HugeiconsIcon
                      aria-hidden="true"
                      className="size-4 shrink-0"
                      icon={PlusSignCircleIcon}
                    />
                    <span className="truncate">Add “{option.name}”</span>
                  </span>
                </ComboboxItem>
              </React.Fragment>
            ) : (
              <ComboboxItem key={option.id} value={option}>
                <span className="truncate">{option.name}</span>
              </ComboboxItem>
            )
          }
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
