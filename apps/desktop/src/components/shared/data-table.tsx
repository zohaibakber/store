import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  ColumnsThreeCogIcon,
  Search01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactTable, Row, RowData, TableFeatures } from "@tanstack/react-table";
import { createContext, use, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Frame, FrameFooter } from "@/components/ui/frame";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Method (not arrow) syntax keeps parameters bivariant so concrete instances
// stay assignable.
interface DataTableColumn {
  readonly id: string;
  readonly columnDef: { meta?: { label?: string } };
  getCanSort(): boolean;
  getIsSorted(): false | "asc" | "desc";
  getToggleSortingHandler(): undefined | ((event: unknown) => void);
  getCanHide(): boolean;
  getIsVisible(): boolean;
  toggleVisibility(value?: boolean): void;
  // Optional: a table built without the column filtering feature — the products
  // table, whose search lives in the command menu — has no filter methods.
  getFilterValue?(): unknown;
  setFilterValue?(value: unknown): void;
}

interface DataTableCell {
  readonly id: string;
}

interface DataTableRow {
  readonly id: string;
  getVisibleCells(): ReadonlyArray<DataTableCell>;
}

interface DataTableHeaderCell {
  readonly id: string;
  readonly colSpan: number;
  readonly isPlaceholder: boolean;
}

interface DataTableInstance {
  readonly state: { readonly pagination?: { pageIndex: number; pageSize: number } };
  FlexRender(this: void, props: { header?: unknown; cell?: unknown }): React.ReactNode;
  getColumn(id: string): DataTableColumn | undefined;
  getAllColumns(): ReadonlyArray<DataTableColumn>;
  getAllLeafColumns(): ReadonlyArray<DataTableColumn>;
  getHeaderGroups(): ReadonlyArray<{ id: string; headers: ReadonlyArray<DataTableHeaderCell> }>;
  getRowModel(): { rows: ReadonlyArray<DataTableRow> };
  getPageCount(): number;
  getRowCount(): number;
  setPageSize(size: number): void;
  getCanPreviousPage(): boolean;
  getCanNextPage(): boolean;
  firstPage(): unknown;
  previousPage(): unknown;
  nextPage(): unknown;
  lastPage(): unknown;
}

interface DataTableContextValue {
  table: DataTableInstance;
  onRowClick?: (row: DataTableRow) => void;
}

const DataTableContext = createContext<DataTableContextValue | null>(null);

function useDataTable() {
  const context = use(DataTableContext);
  if (!context) throw new Error("DataTable components must be used within <DataTable>");
  return context;
}

interface DataTableProps<
  TFeatures extends TableFeatures,
  TData extends RowData,
> extends React.ComponentProps<"div"> {
  table: ReactTable<TFeatures, TData> & DataTableInstance;
  onRowClick?: (row: Row<TFeatures, TData>) => void;
}

function DataTable<TFeatures extends TableFeatures, TData extends RowData>({
  table,
  onRowClick,
  className,
  ...props
}: DataTableProps<TFeatures, TData>) {
  return (
    <DataTableContext
      value={{ table, onRowClick: onRowClick as DataTableContextValue["onRowClick"] }}
    >
      <div className={cn("flex w-full flex-col", className)} data-slot="data-table" {...props} />
    </DataTableContext>
  );
}

function DataTableHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2 py-2", className)}
      data-slot="data-table-header"
      {...props}
    />
  );
}

function DataTableFooter({ className, ...props }: React.ComponentProps<"footer">) {
  return <FrameFooter className={cn("p-2", className)} data-slot="data-table-footer" {...props} />;
}

interface DataTableFilterProps extends React.ComponentProps<typeof InputGroupInput> {
  columnId: string;
}

interface DataTableSelectFilterProps {
  columnId: string;
  label: string;
  options: ReadonlyArray<string>;
}

const ALL_FILTER_VALUES = "__data-table-all-values__";

function DataTableSelectFilter({ columnId, label, options }: DataTableSelectFilterProps) {
  const { table } = useDataTable();
  const column = table.getColumn(columnId);
  const value = (column?.getFilterValue?.() as string | undefined) || ALL_FILTER_VALUES;
  const allLabel = `All ${label.toLowerCase()}`;
  const items = [
    { label: allLabel, value: ALL_FILTER_VALUES },
    ...options.map((option) => ({ label: option, value: option })),
  ];
  const selectedItem = items.find((item) => item.value === value) ?? items[0];

  return (
    <Select
      itemToStringValue={(item) => item.value}
      items={items}
      onValueChange={(nextItem) =>
        column?.setFilterValue?.(
          nextItem?.value === ALL_FILTER_VALUES ? undefined : nextItem?.value,
        )
      }
      value={selectedItem}
    >
      <SelectTrigger aria-label={`Filter by ${label}`} className="w-40" size="sm">
        <SelectValue>{(item) => item?.label ?? allLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function DataTableClearFilters(props: React.ComponentProps<typeof Button>) {
  const { table } = useDataTable();
  const filteredColumns = table
    .getAllColumns()
    .filter((column) => column.getFilterValue?.() !== undefined);

  return (
    <Button
      disabled={filteredColumns.length === 0}
      onClick={() => filteredColumns.forEach((column) => column.setFilterValue?.(undefined))}
      size="sm"
      type="button"
      variant="ghost"
      {...props}
    >
      <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} />
      Clear filters
    </Button>
  );
}

function DataTableFilter({ columnId, className, ...props }: DataTableFilterProps) {
  const { table } = useDataTable();
  const column = table.getColumn(columnId);
  const value = (column?.getFilterValue?.() as string | undefined) ?? "";
  const [expanded, setExpanded] = useState(value.length > 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const accessibleLabel =
    props["aria-label"] ??
    (typeof props.placeholder === "string" ? props.placeholder : "Search table");

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const collapse = () => {
    column?.setFilterValue?.("");
    setExpanded(false);
  };

  return (
    <div
      className={cn(
        "flex shrink-0 justify-end transition-[width] duration-200",
        expanded ? "w-64" : "w-9 sm:w-8",
        className,
      )}
      data-expanded={expanded}
      data-slot="data-table-filter"
    >
      {expanded ? (
        <InputGroup>
          <InputGroupInput
            {...props}
            aria-label={accessibleLabel}
            onChange={(event) => column?.setFilterValue?.(event.target.value)}
            onKeyDown={(event) => {
              props.onKeyDown?.(event);
              if (!event.defaultPrevented && event.key === "Escape") collapse();
            }}
            ref={inputRef}
            role="searchbox"
            type="search"
            value={value}
          />
          <InputGroupAddon align="inline-start">
            <HugeiconsIcon aria-hidden="true" icon={Search01Icon} />
          </InputGroupAddon>
          <InputGroupAddon align="inline-end">
            <Button
              aria-label="Close search"
              onClick={collapse}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} />
            </Button>
          </InputGroupAddon>
        </InputGroup>
      ) : (
        <Button
          aria-expanded={false}
          aria-label={accessibleLabel}
          onClick={() => setExpanded(true)}
          size="icon"
          type="button"
          variant="outline"
        >
          <HugeiconsIcon aria-hidden="true" icon={Search01Icon} />
        </Button>
      )}
    </div>
  );
}

function DataTableViewOptions({ className, ...props }: React.ComponentProps<typeof Button>) {
  const { table } = useDataTable();
  const columns = table.getAllColumns().filter((column) => column.getCanHide());
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button className={cn("ml-auto", className)} size="icon" variant="outline" {...props}>
            <HugeiconsIcon aria-hidden="true" icon={ColumnsThreeCogIcon} />
          </Button>
        }
      />
      <MenuPopup align="end" className="w-40">
        <MenuGroup>
          <MenuGroupLabel>Toggle columns</MenuGroupLabel>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          {columns.map((column) => (
            <MenuCheckboxItem
              checked={column.getIsVisible()}
              key={column.id}
              onCheckedChange={(checked) => column.toggleVisibility(checked)}
            >
              {column.columnDef.meta?.label ?? column.id}
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

interface DataTableColumnHeaderProps extends React.ComponentProps<"div"> {
  column: DataTableColumn;
  title: string;
}

function DataTableColumnHeader({ column, title, className, ...props }: DataTableColumnHeaderProps) {
  if (!column.getCanSort()) {
    return (
      <div className={className} {...props}>
        {title}
      </div>
    );
  }
  const sorted = column.getIsSorted();
  const toggle = column.getToggleSortingHandler();
  return (
    <div
      className={cn("flex h-full cursor-pointer items-center gap-2 select-none", className)}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle?.(event);
        }
      }}
      role="button"
      tabIndex={0}
      {...props}
    >
      {title}
      {sorted === "asc" ? (
        <HugeiconsIcon
          aria-hidden="true"
          className="size-4 shrink-0 opacity-80"
          icon={ArrowUp01Icon}
        />
      ) : sorted === "desc" ? (
        <HugeiconsIcon
          aria-hidden="true"
          className="size-4 shrink-0 opacity-80"
          icon={ArrowDown01Icon}
        />
      ) : (
        <HugeiconsIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground opacity-80"
          icon={UnfoldMoreIcon}
        />
      )}
    </div>
  );
}

function DataTableContent({ className, children, ...props }: React.ComponentProps<"div">) {
  const { table, onRowClick } = useDataTable();
  const rows = table.getRowModel().rows;
  return (
    <Frame className={cn("w-full", className)} {...props}>
      <Table variant="card">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow className="hover:bg-transparent" key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead colSpan={header.colSpan} key={header.id}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                className="h-24 text-center text-muted-foreground"
                colSpan={table.getAllLeafColumns().length}
              >
                No results.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                className={cn(onRowClick && "cursor-pointer")}
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {children}
    </Frame>
  );
}

const pageSizes = [10, 20, 30, 50];

function DataTablePagination({ className, ...props }: React.ComponentProps<"div">) {
  const { table } = useDataTable();
  const { pageIndex, pageSize } = table.state.pagination ?? { pageIndex: 0, pageSize: 10 };
  const rowCount = table.getRowCount();
  const firstResult = rowCount === 0 ? 0 : pageIndex * pageSize + 1;
  const lastResult = Math.min((pageIndex + 1) * pageSize, rowCount);
  const resultRange = `${firstResult}–${lastResult}`;

  return (
    <div className={cn("flex items-center justify-between", className)} {...props}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>Showing</span>
        <Select
          onValueChange={(value) => table.setPageSize(Number(value))}
          value={String(pageSize)}
        >
          <SelectTrigger aria-label="Displayed result range" className="w-auto min-w-0" size="sm">
            <SelectValue>{() => resultRange}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {pageSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} per page
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <span>of {rowCount} results</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          aria-label="Previous page"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
          size="xs"
          type="button"
        >
          Previous
        </Button>
        <Button
          aria-label="Next page"
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
          size="xs"
          type="button"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export {
  DataTable,
  DataTableColumnHeader,
  DataTableContent,
  DataTableClearFilters,
  DataTableFooter,
  DataTableFilter,
  DataTableHeader,
  DataTablePagination,
  DataTableSelectFilter,
  DataTableViewOptions,
  useDataTable,
};
