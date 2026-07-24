import type { Category } from "@store/contracts";
import { PlusSignCircleIcon } from "@hugeicons/core-free-icons";
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
      // No need to clear the query: Base UI fills the input with the selected
      // label immediately after this resolves.
      onChange(created.id);
      toast.success(`Category “${created.name}” added`);
    } catch (error) {
      toast.error(storeErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Combobox
      // Keeps a row under the cursor so Enter always has something to act on —
      // with nothing highlighted it would fall through to the form.
      autoHighlight
      disabled={pending}
      filter={null}
      items={options as CategoryOption[]}
      itemToStringLabel={(item: unknown) => (item as CategoryOption).name}
      itemToStringValue={(item: unknown) => (item as CategoryOption).name}
      name={name}
      // The input's displayed text is Base UI's to own — selecting an item
      // writes the label into it. `query` is only the search term, so it must
      // ignore that write ("item-press"), otherwise reopening the popup on a
      // product that already has a category filters the list down to that one
      // name until the field is cleared by hand.
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
          // The input carries the selected category's label, so without this
          // typing would append to it ("General" + "Syrups").
          event.currentTarget.select();
        }}
        onKeyDown={(event) => {
          // This input lives inside the product form, so a bare Enter would
          // submit the whole product. Enter belongs to the combobox here —
          // Base UI still runs its own selection on the same event.
          if (event.key === "Enter") event.preventDefault();
        }}
        placeholder={selected ? selected.name : "Search or add a category…"}
      />
      <ComboboxPopup>
        <ComboboxList>
          {(option: CategoryOption) =>
            option.create ? (
              <ComboboxItem
                className="border-t data-highlighted:text-accent-foreground py-1.5"
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
