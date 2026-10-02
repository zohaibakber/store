import {
  Add01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Supplier } from "@store/contracts";
import * as React from "react";

import { PageActions } from "@/components/shared/page-actions";
import { PageLayout } from "@/components/shared/page-layout";
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Frame } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { useStoreCommand } from "@/hooks/use-store-command";
import { toastStoreError } from "@/lib/errors";
import { EMPTY } from "@/lib/format";
import { useInventoryActions, usePurchasingGate } from "@/lib/inventory";

import { PurchasingGateNotice } from "./gate-notice";

const MAX_NAME = 200;
const MAX_PHONE = 20;
const MAX_NOTE = 500;

const FORM_ID = "supplier-form";

const digitsOf = (value: string) => value.replace(/\D/gu, "").slice(0, MAX_PHONE);

const normalized = (name: string) => name.trim().toLocaleLowerCase();

function SupplierForm({
  onSaved,
  supplier,
  taken,
}: {
  readonly onSaved: () => void;
  readonly supplier: Supplier | null;
  readonly taken: ReadonlySet<string>;
}) {
  const { saveSupplier } = useInventoryActions();
  const [name, setName] = React.useState(supplier?.name ?? "");
  const [phone, setPhone] = React.useState(supplier?.phone ?? "");
  const [note, setNote] = React.useState(supplier?.note ?? "");
  const [pending, run] = useStoreCommand();
  const trimmed = name.trim();
  const duplicate =
    taken.has(normalized(name)) && normalized(name) !== normalized(supplier?.name ?? "");
  const canSave = trimmed.length > 0 && !duplicate && !pending;

  const save = () => {
    if (!canSave) return;
    void run(async () => {
      const fields = { name: trimmed, phone, note };
      const saved = await saveSupplier(supplier === null ? fields : { ...fields, id: supplier.id });
      toastManager.add({
        title: supplier === null ? `${saved.name} added` : `${saved.name} updated`,
        type: "success",
      });
      onSaved();
    }, "Could not save the supplier.");
  };

  return (
    <>
      <SheetPanel>
        <form
          className="flex flex-col gap-4"
          id={FORM_ID}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Field className="w-full">
            <FieldLabel htmlFor="supplier-name">Name</FieldLabel>
            <Input
              aria-invalid={duplicate || undefined}
              autoFocus
              id="supplier-name"
              maxLength={MAX_NAME}
              onChange={(event) => setName(event.currentTarget.value)}
              value={name}
            />
            {duplicate ? (
              <FieldDescription>A supplier with this name already exists.</FieldDescription>
            ) : null}
          </Field>
          <Field className="w-full">
            <FieldLabel htmlFor="supplier-phone">WhatsApp number</FieldLabel>
            <Input
              id="supplier-phone"
              inputMode="numeric"
              onChange={(event) => setPhone(digitsOf(event.currentTarget.value))}
              placeholder="923001234567"
              value={phone}
            />
            <FieldDescription>
              Digits only, starting with the country code. Used to send orders on WhatsApp.
            </FieldDescription>
          </Field>
          <Field className="w-full">
            <FieldLabel htmlFor="supplier-note">Note</FieldLabel>
            <Textarea
              id="supplier-note"
              maxLength={MAX_NOTE}
              onChange={(event) => setNote(event.currentTarget.value)}
              placeholder="Delivery days, payment terms, contact person"
              rows={3}
              value={note}
            />
          </Field>
        </form>
      </SheetPanel>
      <SheetFooter>
        <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
        <Button disabled={!canSave} form={FORM_ID} loading={pending} type="submit">
          {supplier === null ? "Add supplier" : "Save"}
        </Button>
      </SheetFooter>
    </>
  );
}

function DeleteSupplierDialog({
  disabled,
  supplier,
}: {
  readonly disabled: boolean;
  readonly supplier: Supplier;
}) {
  const { deleteSupplier } = useInventoryActions();
  const remove = async () => {
    try {
      await deleteSupplier(supplier.id);
      toastManager.add({ title: `${supplier.name} deleted`, type: "success" });
    } catch (error) {
      toastStoreError(error, "Could not delete the supplier.");
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            aria-label={`Delete ${supplier.name}`}
            disabled={disabled}
            size="icon-xs"
            variant="ghost"
          />
        }
      >
        <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {supplier.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            A supplier with purchase orders cannot be deleted, so its order history stays intact.
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

function AddSupplierButton({
  disabled,
  onClick,
}: {
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button disabled={disabled} onClick={onClick} size="sm">
      <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
      Add supplier
    </Button>
  );
}

export function SuppliersPage({ suppliers }: { readonly suppliers: ReadonlyArray<Supplier> }) {
  const gate = usePurchasingGate();
  const [editing, setEditing] = React.useState<Supplier | null>(null);
  const [open, setOpen] = React.useState(false);
  const taken = React.useMemo(
    () => new Set(suppliers.map((supplier) => normalized(supplier.name))),
    [suppliers],
  );

  const edit = (supplier: Supplier | null) => {
    setEditing(supplier);
    setOpen(true);
  };

  return (
    <PageLayout>
      <PageActions>
        <AddSupplierButton disabled={gate.blocked} onClick={() => edit(null)} />
      </PageActions>
      <PurchasingGateNotice gate={gate} />
      <Frame className="w-full">
        {suppliers.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon aria-hidden="true" icon={UserMultipleIcon} />
              </EmptyMedia>
              <EmptyTitle>No suppliers yet</EmptyTitle>
              <EmptyDescription>
                Add the wholesalers and distributors you buy from, then send them purchase orders.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <AddSupplierButton disabled={gate.blocked} onClick={() => edit(null)} />
            </EmptyContent>
          </Empty>
        ) : (
          <Table className="table-fixed" variant="card">
            <TableHeader>
              <TableRow>
                <TableHead className="w-72">Name</TableHead>
                <TableHead className="w-48">WhatsApp number</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-24">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((supplier) => (
                <TableRow key={supplier.id}>
                  <TableCell className="max-w-0">
                    <span className="block truncate leading-tight font-medium">
                      {supplier.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        supplier.phone ? "tabular-nums" : "text-muted-foreground tabular-nums"
                      }
                    >
                      {supplier.phone ?? EMPTY}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-0">
                    <span className="block truncate text-muted-foreground">
                      {supplier.note ?? EMPTY}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="-my-1 flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              aria-label={`Edit ${supplier.name}`}
                              disabled={gate.blocked}
                              onClick={() => edit(supplier)}
                              size="icon-xs"
                              variant="ghost"
                            />
                          }
                        >
                          <HugeiconsIcon aria-hidden="true" icon={PencilEdit02Icon} />
                        </TooltipTrigger>
                        <TooltipPopup>Edit</TooltipPopup>
                      </Tooltip>
                      <DeleteSupplierDialog disabled={gate.blocked} supplier={supplier} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Frame>
      <Sheet onOpenChange={setOpen} open={open}>
        <SheetPopup showCloseButton={false} variant="inset">
          <SheetHeader>
            <SheetTitle>{editing === null ? "Add supplier" : "Edit supplier"}</SheetTitle>
            <SheetDescription>
              The name appears on purchase orders. The number is used for WhatsApp.
            </SheetDescription>
          </SheetHeader>
          {open ? (
            <SupplierForm
              key={editing?.id ?? "new"}
              onSaved={() => setOpen(false)}
              supplier={editing}
              taken={taken}
            />
          ) : null}
        </SheetPopup>
      </Sheet>
    </PageLayout>
  );
}
