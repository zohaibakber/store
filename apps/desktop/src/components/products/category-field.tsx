import { PlusSignCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Category } from "@store/contracts";
import { useState } from "react";

import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@/components/ui/combobox";
import { toastManager } from "@/components/ui/toast";
import { storeErrorMessage } from "@/lib/errors";
import { useStore } from "@/lib/store";

interface CategoryOption {
  readonly id: string;
  readonly name: string;
  readonly create?: boolean;
}

const byName = (a: CategoryOption, b: CategoryOption) => a.name.localeCompare(b.name);

export function CategoryField({
  id,
  invalid,
  name,
  onChange,
  seed,
  value,
}: {
  id?: string;
  invalid?: boolean;
  name?: string;
  onChange: (categoryId: string) => void;
  seed: ReadonlyArray<Category>;
  value: string;
}) {
  const store = useStore();
  const [categories, setCategories] = useState<ReadonlyArray<CategoryOption>>(() =>
    [...seed].map((category) => ({ id: category.id, name: category.name })).sort(byName),
  );
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);

  const term = query.trim();
  const selected = categories.find((category) => category.id === value) ?? null;
  const lowered = term.toLowerCase();
  const matches = term
    ? categories.filter((category) => category.name.toLowerCase().includes(lowered))
    : categories;
  const exists = categories.some((category) => category.name.toLowerCase() === lowered);
  const createOption: CategoryOption = { id: `create:${term}`, name: term, create: true };
  const options: ReadonlyArray<CategoryOption> = [...matches, createOption];
  const canCreate = term.length > 0 && !exists;

  const select = async (option: CategoryOption | null) => {
    if (!option) return;
    if (!option.create) {
      onChange(option.id);
      return;
    }

    setPending(true);
    try {
      const created = await store.createCategory({ name: option.name });
      setCategories((current) =>
        current.some((category) => category.id === created.id)
          ? current
          : [...current, { id: created.id, name: created.name }].sort(byName),
      );
      onChange(created.id);
      toastManager.add({ title: `Category “${created.name}” added`, type: "success" });
    } catch (error) {
      toastManager.add({ title: storeErrorMessage(error), type: "error" });
    } finally {
      setPending(false);
    }
  };

  return (
    <Combobox
      autoHighlight
      disabled={pending}
      filter={null}
      items={options as CategoryOption[]}
      itemToStringLabel={(item: unknown) => (item as CategoryOption).name}
      itemToStringValue={(item: unknown) => (item as CategoryOption).name}
      name={name}
      onInputValueChange={(next: string, details: { reason?: string }) => {
        if (details.reason === "item-press") return;
        setQuery(next);
      }}
      onValueChange={(option: unknown) => {
        setQuery("");
        void select(option as CategoryOption | null);
      }}
      value={selected}
    >
      <ComboboxInput
        aria-invalid={invalid || undefined}
        className="w-full"
        id={id}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        placeholder={selected ? selected.name : "Search or add a category…"}
      />
      <ComboboxPopup>
        <ComboboxList>
          {(option: CategoryOption) =>
            option.create ? (
              <ComboboxItem
                className="border-t py-1.5 data-highlighted:text-accent-foreground"
                disabled={!canCreate}
                key="create"
                value={option}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <HugeiconsIcon
                    aria-hidden="true"
                    className="size-4 shrink-0"
                    icon={PlusSignCircleIcon}
                  />
                  <span className="truncate">
                    {canCreate ? `Add “${option.name}”` : "Type a name to add a category"}
                  </span>
                </span>
              </ComboboxItem>
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
