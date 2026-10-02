import { Cancel01Icon, Search01Icon, ShoppingBasket01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { purchaseOrderTotal, type Product, type Supplier } from "@store/contracts";
import { formatPrice } from "@store/services/format";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";

import { LoadingSpinner } from "@/components/app/loading-spinner";
import { useWindowKeydown } from "@/components/products/shortcuts";
import { FrameCard } from "@/components/shared/frame-card";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@/components/ui/autocomplete";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SheetClose, SheetFooter, SheetPanel } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { toastManager } from "@/components/ui/toast";
import { toastStoreError } from "@/lib/errors";
import { EMPTY, formatCount, pluralize } from "@/lib/format";
import {
  useInventoryActions,
  useLearnedSuppliers,
  useProductsOnOrder,
  usePurchasingGate,
  useSuspenseProductSearch,
  useSuspenseSuppliers,
} from "@/lib/inventory";

import { PurchasingGateNotice } from "./gate-notice";
import { draftLineCost, quantityNoun, type DraftLine } from "./presentation";
import { SupplierPicker } from "./supplier-picker";

const RESULT_LIMIT = 20;

const UNASSIGNED = "unassigned";

type BuilderLine = Omit<DraftLine, "quantity"> & {
  readonly quantity: number | null;
  readonly supplierId?: Supplier["id"] | null;
};

type BuilderGroup = {
  readonly key: string;
  readonly supplier: Supplier | null;
  readonly lines: ReadonlyArray<BuilderLine>;
};

const quantityItems = [
  { label: "Pack", value: "pack" },
  { label: "Unit", value: "unit" },
] as const;

const lineOfProduct = (product: Product): BuilderLine => ({
  productId: product.id,
  name: product.name,
  quantity: 1,
  quantityType: product.category.tracksPacks ? "pack" : "unit",
  unitsPerPack: product.unitsPerPack,
  tracksPacks: product.category.tracksPacks,
  packCost: product.purchasePrice,
});

const isOrderable = (quantity: number | null): quantity is number =>
  quantity !== null && Number.isInteger(quantity) && quantity >= 1;

const lineCost = (line: BuilderLine) =>
  isOrderable(line.quantity) ? draftLineCost(line, line.quantity) : null;

const groupTotal = (lines: ReadonlyArray<BuilderLine>) => purchaseOrderTotal(lines.map(lineCost));

function ProductSearch({ onPick }: { readonly onPick: (product: Product) => void }) {
  const [query, setQuery] = React.useState("");
  const term = query.trim();
  const searchTerm = React.useDeferredValue(term);
  const products = useSuspenseProductSearch(searchTerm, RESULT_LIMIT);
  const items = term === "" ? [] : products;
  const isStale = searchTerm !== term;

  return (
    <Autocomplete
      autoHighlight="always"
      filter={null}
      items={items}
      itemToStringValue={(product: Product) => product.name}
      onValueChange={(value, details) => {
        if (details.reason !== "item-press") setQuery(value);
      }}
      value={query}
    >
      <AutocompleteInput
        aria-label="Add a product"
        onKeyDown={(event) => {
          if (event.key === "Enter" && term && isStale) {
            event.preventDefault();
            event.preventBaseUIHandler();
          }
        }}
        placeholder="Search products to add…"
        showClear
        startAddon={<HugeiconsIcon aria-hidden="true" icon={Search01Icon} />}
      />
      <AutocompletePopup>
        <AutocompleteEmpty>No matching products.</AutocompleteEmpty>
        <AutocompleteList>
          {(product: Product) => (
            <AutocompleteItem
              key={product.id}
              onClick={() => {
                onPick(product);
                setQuery("");
              }}
              value={product}
            >
              <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <span className="min-w-0 truncate capitalize">{product.name}</span>
                {product.strength ? (
                  <span className="shrink-0 text-muted-foreground">{product.strength}</span>
                ) : null}
                <span className="min-w-0 flex-1 basis-0 truncate text-xs text-muted-foreground">
                  {product.category.name}
                </span>
              </span>
              <span className="ms-3 text-muted-foreground tabular-nums">
                {formatPrice(product.purchasePrice)}
              </span>
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>
  );
}

function BuilderLineRow({
  canCreateSupplier,
  line,
  onChange,
  onOrderUnits,
  onRemove,
  supplier,
  suppliers,
}: {
  readonly canCreateSupplier: boolean;
  readonly line: BuilderLine;
  readonly onChange: (patch: Partial<BuilderLine>) => void;
  readonly onOrderUnits: number;
  readonly onRemove: () => void;
  readonly supplier: Supplier | null;
  readonly suppliers: ReadonlyArray<Supplier>;
}) {
  const cost = lineCost(line);
  const details = [
    ...(line.tracksPacks && line.unitsPerPack > 1 ? [`${line.unitsPerPack} per pack`] : []),
    ...(onOrderUnits > 0 ? [`${formatCount(onOrderUnits, "unit")} already on order`] : []),
  ];
  return (
    <TableRow>
      <TableCell className="max-w-0">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate leading-tight font-medium capitalize">{line.name}</span>
          {details.length > 0 ? (
            <span className="truncate text-xs leading-tight text-muted-foreground tabular-nums">
              {details.join(" · ")}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="w-44">
        <div className="flex items-center gap-1">
          <NumberField
            className="w-16"
            format={{ useGrouping: false }}
            min={1}
            onValueChange={(quantity) => onChange({ quantity })}
            size="sm"
            step={1}
            value={line.quantity}
          >
            <NumberFieldGroup>
              <NumberFieldInput
                aria-invalid={isOrderable(line.quantity) ? undefined : true}
                aria-label={`Quantity of ${line.name}`}
              />
            </NumberFieldGroup>
          </NumberField>
          {line.tracksPacks ? (
            <Select
              items={quantityItems}
              onValueChange={(quantityType) => quantityType && onChange({ quantityType })}
              value={line.quantityType}
            >
              <SelectTrigger
                aria-label={`Quantity unit of ${line.name}`}
                className="w-20 min-w-0"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {quantityItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground">
              {pluralize(line.quantity ?? 0, quantityNoun(line.quantityType))}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="w-28">
        <span
          className={
            cost === null
              ? "block text-end text-muted-foreground tabular-nums"
              : "block text-end tabular-nums"
          }
        >
          {cost === null ? EMPTY : formatPrice(cost)}
        </span>
      </TableCell>
      <TableCell className="w-52">
        <SupplierPicker
          canCreate={canCreateSupplier}
          label={`Supplier for ${line.name}`}
          onChange={(supplierId) => onChange({ supplierId })}
          suppliers={suppliers}
          value={supplier?.id ?? null}
        />
      </TableCell>
      <TableCell className="w-12">
        <div className="flex justify-end">
          <Button
            aria-label={`Remove ${line.name}`}
            onClick={onRemove}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function OrderBuilderBody({
  onOrdered,
  seed,
}: {
  readonly onOrdered?: (productIds: ReadonlyArray<string>) => void;
  readonly seed: ReadonlyArray<DraftLine>;
}) {
  const navigate = useNavigate();
  const { saveOrderDraft } = useInventoryActions();
  const gate = usePurchasingGate();
  const suppliers = useSuspenseSuppliers();
  const [lines, setLines] = React.useState<ReadonlyArray<BuilderLine>>(seed);
  const [pending, setPending] = React.useState(false);
  const productIds = React.useMemo(() => lines.map((line) => line.productId), [lines]);
  const learned = useLearnedSuppliers(productIds);
  const onOrder = useProductsOnOrder(productIds);

  const groups = React.useMemo((): ReadonlyArray<BuilderGroup> => {
    const known = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const byKey = new Map<string, { supplier: Supplier | null; lines: Array<BuilderLine> }>();
    for (const line of lines) {
      const supplierId =
        line.supplierId === undefined
          ? (learned.data.get(line.productId) ?? null)
          : line.supplierId;
      const supplier = supplierId === null ? null : (known.get(supplierId) ?? null);
      const key = supplier === null ? UNASSIGNED : supplier.id;
      const group = byKey.get(key);
      if (group) group.lines.push(line);
      else byKey.set(key, { supplier, lines: [line] });
    }
    return [...byKey]
      .map(([key, group]) => ({ key, ...group }))
      .sort((left, right) =>
        left.supplier === null
          ? -1
          : right.supplier === null
            ? 1
            : left.supplier.name.localeCompare(right.supplier.name),
      );
  }, [learned.data, lines, suppliers]);

  const unassigned = groups.find((group) => group.supplier === null)?.lines.length ?? 0;
  const orderCount = groups.length - (unassigned > 0 ? 1 : 0);
  const invalid = lines.some((line) => !isOrderable(line.quantity));
  const canCreate = !gate.blocked && !pending && lines.length > 0 && unassigned === 0 && !invalid;

  const change = (productId: string, patch: Partial<BuilderLine>) =>
    setLines((current) =>
      current.map((line) => (line.productId === productId ? { ...line, ...patch } : line)),
    );

  const drop = (ids: ReadonlySet<string>) =>
    setLines((current) => current.filter((line) => !ids.has(line.productId)));

  const assign = (group: BuilderGroup, supplierId: Supplier["id"]) => {
    const ids = new Set(group.lines.map((line) => line.productId));
    setLines((current) =>
      current.map((line) => (ids.has(line.productId) ? { ...line, supplierId } : line)),
    );
  };

  const add = (product: Product) => {
    if (lines.some((line) => line.productId === product.id)) {
      toastManager.add({ title: `${product.name} is already on this order`, type: "info" });
      return;
    }
    setLines((current) => [...current, lineOfProduct(product)]);
  };

  const create = async () => {
    if (!canCreate) return;
    setPending(true);
    const created: Array<string> = [];
    try {
      for (const group of groups) {
        if (group.supplier === null) continue;
        const saved = await saveOrderDraft({
          supplierId: group.supplier.id,
          lines: group.lines.flatMap((line) =>
            isOrderable(line.quantity)
              ? [
                  {
                    productId: line.productId,
                    quantity: line.quantity,
                    quantityType: line.quantityType,
                  },
                ]
              : [],
          ),
        });
        created.push(saved.order.id);
        const ordered = group.lines.map((line) => line.productId);
        drop(new Set(ordered));
        onOrdered?.(ordered);
      }
    } catch (error) {
      setPending(false);
      toastStoreError(
        error,
        created.length === 0
          ? "Could not create the order."
          : `${formatCount(created.length, "order")} created. The next one could not be saved.`,
      );
      return;
    }
    setPending(false);
    toastManager.add({
      title: `${formatCount(created.length, "draft order")} created`,
      type: "success",
    });
    const [only, ...others] = created;
    if (only !== undefined && others.length === 0) {
      void navigate({ to: "/purchases/$orderId", params: { orderId: only } });
    } else {
      void navigate({ to: "/purchases", search: { tab: "drafts" } });
    }
  };

  useWindowKeydown((event) => {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.defaultPrevented || event.repeat) return;
    event.preventDefault();
    void create();
  });

  const summary =
    lines.length === 0
      ? ""
      : unassigned > 0
        ? `${formatCount(unassigned, "line")} still ${unassigned === 1 ? "needs" : "need"} a supplier`
        : invalid
          ? "Enter a quantity of at least 1 on every line"
          : `${formatCount(lines.length, "line")} · est. ${formatPrice(groupTotal(lines))}`;

  return (
    <>
      <SheetPanel>
        <div className="flex flex-col gap-4">
          <PurchasingGateNotice gate={gate} />
          <React.Suspense fallback={<LoadingSpinner className="h-9" />}>
            <ProductSearch onPick={add} />
          </React.Suspense>
          {lines.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon aria-hidden="true" icon={ShoppingBasket01Icon} />
                </EmptyMedia>
                <EmptyTitle>No products yet</EmptyTitle>
                <EmptyDescription>
                  Search above to add products, or select rows on the Restock page and choose Order
                  selected.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : learned.isLoading ? (
            <LoadingSpinner className="h-48" />
          ) : (
            groups.map((group) => (
              <FrameCard
                action={
                  group.supplier === null ? (
                    <div className="w-56">
                      <SupplierPicker
                        canCreate={!gate.blocked}
                        label="Supplier for all unassigned lines"
                        onChange={(supplierId) => assign(group, supplierId)}
                        placeholder="Assign all to…"
                        suppliers={suppliers}
                        value={null}
                      />
                    </div>
                  ) : undefined
                }
                description={`${formatCount(group.lines.length, "line")} · est. ${formatPrice(groupTotal(group.lines))}`}
                key={group.key}
                table
                title={group.supplier === null ? "Needs a supplier" : group.supplier.name}
              >
                <Table className="table-fixed" variant="card">
                  <TableBody>
                    {group.lines.map((line) => (
                      <BuilderLineRow
                        canCreateSupplier={!gate.blocked}
                        key={line.productId}
                        line={line}
                        onChange={(patch) => change(line.productId, patch)}
                        onOrderUnits={onOrder.data.get(line.productId)?.onOrderBaseUnits ?? 0}
                        onRemove={() => drop(new Set([line.productId]))}
                        supplier={group.supplier}
                        suppliers={suppliers}
                      />
                    ))}
                  </TableBody>
                </Table>
              </FrameCard>
            ))
          )}
        </div>
      </SheetPanel>
      <SheetFooter className="sm:justify-between">
        <p className="self-center text-sm text-muted-foreground tabular-nums">{summary}</p>
        <div className="flex gap-2">
          <SheetClose render={<Button size="sm" variant="ghost" />}>Cancel</SheetClose>
          <Button
            aria-keyshortcuts="Control+Enter"
            disabled={!canCreate}
            loading={pending}
            onClick={() => void create()}
            size="sm"
            type="button"
          >
            {orderCount === 0 ? "Create orders" : `Create ${formatCount(orderCount, "order")}`}
          </Button>
        </div>
      </SheetFooter>
    </>
  );
}
