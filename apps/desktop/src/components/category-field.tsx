import type { Category } from "@store/contracts";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@/components/ui/combobox";
import { storeErrorMessage } from "@/lib/errors";
import { toast } from "@/lib/toast";

interface CategoryOption {
  readonly id: string;
  readonly name: string;
  /** A pseudo-option that creates the category rather than selecting one. */
  readonly create?: boolean;
}

const byName = (a: CategoryOption, b: CategoryOption) => a.name.localeCompare(b.name);

/**
 * Picks a category, and creates one from whatever was typed when nothing
 * matches — the catalog ships with three seeded categories and no other way to
 * add more. Creating happens inline rather than behind a dialog so the product
 * form is never interrupted.
 */
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
  // The create row is always the last option so the popup advertises that
  // categories can be added from here; it only acts once there is a name to
  // create, and says so until then.
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
      const created = await window.offlineStore.createCategory({ name: option.name });
      setCategories((current) =>
        current.some((category) => category.id === created.id)
          ? current
          : [...current, { id: created.id, name: created.name }].sort(byName),
      );
      onChange(created.id);
      setQuery("");
      toast.success(`Category “${created.name}” added`);
    } catch (error) {
      toast.error(storeErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Combobox
      disabled={pending}
      filter={null}
      inputValue={query}
      items={options as CategoryOption[]}
      itemToStringLabel={(item: unknown) => (item as CategoryOption).name}
      itemToStringValue={(item: unknown) => (item as CategoryOption).name}
      name={name}
      onInputValueChange={setQuery}
      onValueChange={(option: unknown) => {
        void select(option as CategoryOption | null);
      }}
      value={selected}
    >
      <ComboboxInput
        aria-invalid={invalid || undefined}
        className="w-full"
        id={id}
        placeholder={selected ? selected.name : "Search or add a category…"}
      />
      <ComboboxPopup>
        <ComboboxList>
          {(option: CategoryOption) =>
            option.create ? (
              <ComboboxItem
                className="border-t text-muted-foreground data-highlighted:text-accent-foreground"
                disabled={!canCreate}
                key="create"
                value={option}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <HugeiconsIcon aria-hidden="true" className="size-4 shrink-0" icon={Add01Icon} />
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
