import { PlusSignCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Category } from "@store/contracts";
import { useInventoryActions } from "@store/inventory-react";
import * as React from "react";
import { useMemo, useState } from "react";

import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSeparator,
} from "@/components/ui/combobox";
import { toastManager } from "@/components/ui/toast";
import { useStoreCommand } from "@/hooks/use-store-command";

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
  const { createCategory } = useInventoryActions();
  const [createdOverSeed, setCreatedOverSeed] = useState<ReadonlyArray<CategoryOption>>([]);
  const categories = useMemo(() => {
    const byId = new Map<string, CategoryOption>();
    for (const category of seed) byId.set(category.id, { id: category.id, name: category.name });
    for (const category of createdOverSeed) byId.set(category.id, category);
    return [...byId.values()].sort(byName);
  }, [seed, createdOverSeed]);
  const [query, setQuery] = useState("");
  const [pending, run] = useStoreCommand();

  const term = query.trim();
  const selected = categories.find((category) => category.id === value) ?? null;
  const lowered = term.toLowerCase();
  const matches = term
    ? categories.filter((category) => category.name.toLowerCase().includes(lowered))
    : categories;
  const exists = categories.some((category) => category.name.toLowerCase() === lowered);
  const canCreate = term.length > 0 && !exists;
  const options: ReadonlyArray<CategoryOption> = canCreate
    ? [...matches, { id: `create:${term}`, name: term, create: true }]
    : matches;

  const select = async (option: CategoryOption | null) => {
    if (!option) return;
    if (!option.create) {
      onChange(option.id);
      return;
    }

    await run(async () => {
      const category = await createCategory({ name: option.name });
      setCreatedOverSeed((current) =>
        current.some((existing) => existing.id === category.id)
          ? current
          : [...current, { id: category.id, name: category.name }],
      );
      onChange(category.id);
      toastManager.add({ title: `${category.name} added`, type: "success" });
    });
  };

  return (
    <Combobox
      autoHighlight
      disabled={pending}
      filter={null}
      items={[...options]}
      itemToStringLabel={(item) => item.name}
      itemToStringValue={(item) => item.name}
      name={name}
      onInputValueChange={(next: string, details: { reason?: string }) => {
        if (details.reason === "item-press") return;
        setQuery(next);
      }}
      onValueChange={(option) => {
        setQuery("");
        void select(option);
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
              <React.Fragment key="create">
                {matches.length > 0 ? <ComboboxSeparator /> : null}
                <ComboboxItem value={option}>
                  <span className="flex min-w-0 items-center gap-2">
                    <HugeiconsIcon
                      aria-hidden="true"
                      className="size-4 shrink-0"
                      icon={PlusSignCircleIcon}
                    />
                    <span className="truncate">Create “{option.name}”</span>
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
