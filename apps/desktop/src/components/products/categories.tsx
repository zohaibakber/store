import { Delete02Icon, InformationCircleIcon, PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Category } from "@store/contracts";
import { Suspense, useId, useMemo, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Frame } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { toastStoreError } from "@/lib/errors";
import { EMPTY, formatNumber } from "@/lib/format";
import { useInventoryActions, useSuspenseProductCount } from "@/lib/inventory";

const MAX_NAME = 64;

const PACKS_HINT =
  "Off for items sold one at a time: products skip pack size and pack price, and stock arrives as a quantity with an expiry. Purchase price stays the pack cost.";

const normalized = (name: string) => name.trim().toLocaleLowerCase();

type InventoryActions = ReturnType<typeof useInventoryActions>;

function ProductCount({ categoryId }: { readonly categoryId: string }) {
  return <>{formatNumber(useSuspenseProductCount({ categoryId }))}</>;
}

function SoldAsHeader() {
  return (
    <span className="inline-flex items-center gap-1">
      Sold as
      <Tooltip>
        <TooltipTrigger
          render={<Button aria-label="About selling in packs" size="icon-xs" variant="ghost" />}
        >
          <HugeiconsIcon aria-hidden="true" icon={InformationCircleIcon} />
        </TooltipTrigger>
        <TooltipPopup className="max-w-72">{PACKS_HINT}</TooltipPopup>
      </Tooltip>
    </span>
  );
}

function NewCategoryRow({
  createCategory,
  taken,
}: {
  readonly createCategory: InventoryActions["createCategory"];
  readonly taken: ReadonlySet<string>;
}) {
  const [name, setName] = useState("");
  const [tracksPacks, setTracksPacks] = useState(true);
  const [pending, setPending] = useState(false);
  const switchId = useId();
  const trimmed = name.trim();
  const duplicate = taken.has(normalized(name));
  const canSave = trimmed.length > 0 && trimmed.length <= MAX_NAME && !duplicate && !pending;

  const save = async () => {
    if (!canSave) return;
    setPending(true);
    try {
      const category = await createCategory({ name: trimmed, tracksPacks });
      toastManager.add({ title: `${category.name} added`, type: "success" });
      setName("");
    } catch (error) {
      toastStoreError(error, "Could not add the category.");
    }
    setPending(false);
  };

  return (
    <TableRow>
      <TableCell>
        <Input
          aria-invalid={duplicate || undefined}
          aria-label="New category name"
          disabled={pending}
          maxLength={MAX_NAME}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
            if (event.key === "Escape" && name) {
              event.preventDefault();
              setName("");
            }
          }}
          placeholder={duplicate ? "Already exists" : "New category name"}
          size="sm"
          type="text"
          value={name}
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch checked={tracksPacks} id={switchId} onCheckedChange={setTracksPacks} />
          <Label htmlFor={switchId}>Sold in packs</Label>
        </div>
      </TableCell>
      <TableCell />
      <TableCell>
        <div className="flex justify-end">
          <Button disabled={!canSave} onClick={() => void save()} size="sm" type="button">
            Add
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function CategoryName({
  category,
  editing,
  onEditingChange,
  taken,
  updateCategory,
}: {
  readonly category: Category;
  readonly editing: boolean;
  readonly onEditingChange: (editing: boolean) => void;
  readonly taken: ReadonlySet<string>;
  readonly updateCategory: InventoryActions["updateCategory"];
}) {
  const [draft, setDraft] = useState(category.name);
  const cancelled = useRef(false);

  const commit = async () => {
    const trimmed = draft.trim();
    onEditingChange(false);
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(category.name);
      return;
    }
    if (trimmed === category.name || trimmed.length === 0) {
      setDraft(category.name);
      return;
    }
    if (taken.has(normalized(trimmed)) && normalized(trimmed) !== normalized(category.name)) {
      toastManager.add({ title: `${trimmed} already exists`, type: "error" });
      setDraft(category.name);
      return;
    }
    try {
      await updateCategory({ id: category.id, name: trimmed, tracksPacks: category.tracksPacks });
      toastManager.add({ title: "Category renamed", type: "success" });
    } catch (error) {
      setDraft(category.name);
      toastStoreError(error, "Could not rename the category.");
    }
  };

  if (editing) {
    return (
      <Input
        aria-label={`Rename ${category.name}`}
        autoFocus
        maxLength={MAX_NAME}
        onBlur={() => void commit()}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
        size="sm"
        type="text"
        value={draft}
      />
    );
  }

  return (
    <button
      className="max-w-full cursor-text truncate rounded-sm text-start font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => {
        setDraft(category.name);
        onEditingChange(true);
      }}
      title="Click to rename"
      type="button"
    >
      {category.name}
    </button>
  );
}

function DeleteCategoryDialog({
  category,
  deleteCategory,
}: {
  readonly category: Category;
  readonly deleteCategory: InventoryActions["deleteCategory"];
}) {
  const remove = async () => {
    try {
      await deleteCategory(category.id);
      toastManager.add({ title: `${category.name} deleted`, type: "success" });
    } catch (error) {
      toastStoreError(error, "Could not delete the category.");
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button aria-label={`Delete ${category.name}`} size="icon-xs" variant="ghost" />}
      >
        <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {category.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Products still in this category keep it, so move them first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <AlertDialogClose render={<Button variant="destructive" />} onClick={() => void remove()}>
            Delete
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CategoryRow({
  actions,
  category,
  taken,
}: {
  readonly actions: InventoryActions;
  readonly category: Category;
  readonly taken: ReadonlySet<string>;
}) {
  const [editing, setEditing] = useState(false);
  const switchLabel = `Sell ${category.name} in packs`;

  const setTracksPacks = async (tracksPacks: boolean) => {
    try {
      await actions.updateCategory({ id: category.id, name: category.name, tracksPacks });
    } catch (error) {
      toastStoreError(error, "Could not update the category.");
    }
  };

  return (
    <TableRow>
      <TableCell>
        <CategoryName
          category={category}
          editing={editing}
          onEditingChange={setEditing}
          taken={taken}
          updateCategory={actions.updateCategory}
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch
            aria-label={switchLabel}
            checked={category.tracksPacks}
            onCheckedChange={(next) => void setTracksPacks(next)}
          />
          <span className="text-muted-foreground">
            {category.tracksPacks ? "Packs" : "Single units"}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="text-end tabular-nums">
          <Suspense fallback={<span className="text-muted-foreground">{EMPTY}</span>}>
            <ProductCount categoryId={category.id} />
          </Suspense>
        </div>
      </TableCell>
      <TableCell>
        <div className="-my-1 flex justify-end gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={`Rename ${category.name}`}
                  onClick={() => setEditing(true)}
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              <HugeiconsIcon aria-hidden="true" icon={PencilEdit02Icon} />
            </TooltipTrigger>
            <TooltipPopup>Rename</TooltipPopup>
          </Tooltip>
          <DeleteCategoryDialog category={category} deleteCategory={actions.deleteCategory} />
        </div>
      </TableCell>
    </TableRow>
  );
}

export function CategoriesTable({ categories }: { readonly categories: ReadonlyArray<Category> }) {
  const actions = useInventoryActions();
  const sorted = useMemo(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories],
  );
  const taken = useMemo(
    () => new Set(categories.map((category) => normalized(category.name))),
    [categories],
  );

  return (
    <Frame className="w-full">
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>
              <SoldAsHeader />
            </TableHead>
            <TableHead>
              <div className="text-end">Products</div>
            </TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <NewCategoryRow createCategory={actions.createCategory} taken={taken} />
          {sorted.map((category) => (
            <CategoryRow actions={actions} category={category} key={category.id} taken={taken} />
          ))}
        </TableBody>
      </Table>
    </Frame>
  );
}
