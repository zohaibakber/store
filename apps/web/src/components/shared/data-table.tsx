import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  ColumnsThreeCogIcon,
  FilterIcon,
  Search01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  metaHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  type Column,
  type ReactTable,
  type Row,
  type RowData,
} from "@tanstack/react-table";
import { Children, createContext, isValidElement, use, useEffect, useId, useRef } from "react";
import type React from "react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@/components/ui/combobox";
import { Frame, FrameFooter } from "@/components/ui/frame";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
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
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
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
import { formatCount, formatNumber } from "@/lib/format";
import { isString } from "@/lib/predicates";
import { isEditableTarget } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

interface DataTableColumnMeta {
  readonly label?: string;
  readonly align?: "start" | "end";
}

const listTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

type ListTableFeatures = typeof listTableFeatures;

type DataTableColumn = Column<ListTableFeatures, RowData>;

type DataTableRow = Row<ListTableFeatures, RowData>;

const columnAlign = (column: DataTableColumn) => column.columnDef.meta?.align ?? "start";

const filterValueOf = (column: DataTableColumn | undefined) => {
  const value = column?.getFilterValue();
  return isString(value) ? value : undefined;
};

interface DataTableContextValue {
  table: ReactTable<ListTableFeatures, RowData>;
  onRowClick?: (row: DataTableRow) => void;
  onRowPreload?: (row: DataTableRow) => void;
}

const DataTableContext = createContext<DataTableContextValue | null>(null);

function useDataTable() {
  const context = use(DataTableContext);
  if (!context) throw new Error("DataTable components must be used within <DataTable>");
  return context;
}

interface DataTableProps<TData extends RowData> extends React.ComponentProps<"div"> {
  table: ReactTable<ListTableFeatures, TData>;
  onRowClick?: (row: Row<ListTableFeatures, TData>) => void;
  onRowPreload?: (row: Row<ListTableFeatures, TData>) => void;
}

function DataTable<TData extends RowData>({
  table,
  onRowClick,
  onRowPreload,
  className,
  ...props
}: DataTableProps<TData>) {
  return (
    <DataTableContext
      // SAFETY: The context erases the row type; rows reach the callbacks only from this table.
      value={{
        table: table as DataTableContextValue["table"],
        onRowClick: onRowClick as DataTableContextValue["onRowClick"],
        onRowPreload: onRowPreload as DataTableContextValue["onRowPreload"],
      }}
    >
      <div className={cn("flex w-full flex-col", className)} data-slot="data-table" {...props} />
    </DataTableContext>
  );
}

function DataTableFooter({ children, className, ...props }: React.ComponentProps<"footer">) {
  return (
    <FrameFooter className={className} data-slot="data-table-footer" {...props}>
      <div className="-mx-3 -my-2">{children}</div>
    </FrameFooter>
  );
}

interface DataTableFilterProps extends React.ComponentProps<typeof InputGroupInput> {
  columnId: string;
  shortcut?: boolean;
}

interface DataTableFilterOptionProps {
  columnId: string;
  label: string;
  options: ReadonlyArray<string>;
}

function DataTableFilterOption({ columnId, label, options }: DataTableFilterOptionProps) {
  const { table } = useDataTable();
  const column = table.getColumn(columnId);
  const value = filterValueOf(column) || null;
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Combobox
        autoHighlight
        items={[...options]}
        onValueChange={(next: string | null) => column?.setFilterValue(next ?? undefined)}
        value={value}
      >
        <ComboboxInput id={id} placeholder={`Any ${label.toLowerCase()}`} showClear size="sm" />
        <ComboboxPopup>
          <ComboboxEmpty>No matches</ComboboxEmpty>
          <ComboboxList>
            {(option: string) => (
              <ComboboxItem key={option} value={option}>
                <span className="truncate">{option}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}

interface DataTableFilterMenuProps extends Omit<React.ComponentProps<typeof Button>, "children"> {
  children: React.ReactNode;
}

function DataTableFilterMenu({ children, className, ...props }: DataTableFilterMenuProps) {
  const { table } = useDataTable();
  const optionColumnIds = new Set(
    Children.toArray(children).flatMap((child) =>
      isValidElement<DataTableFilterOptionProps>(child) ? [child.props.columnId] : [],
    ),
  );
  const filteredColumns = table
    .getAllColumns()
    .filter((column) => optionColumnIds.has(column.id) && Boolean(filterValueOf(column)));

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label="Filter table"
            className={cn("relative", className)}
            size="icon-sm"
            variant="outline"
            {...props}
          >
            <HugeiconsIcon aria-hidden="true" icon={FilterIcon} />
            {filteredColumns.length > 0 && (
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-background"
              />
            )}
          </Button>
        }
      />
      <PopoverPopup align="end" className="w-72">
        <div className="flex flex-col gap-3">
          {children}
          <Button
            className="self-end"
            disabled={filteredColumns.length === 0}
            onClick={() =>
              table.setColumnFilters((filters) =>
                filters.filter((filter) => !optionColumnIds.has(filter.id)),
              )
            }
            size="sm"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} />
            Clear filters
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function DataTableFilter({ columnId, className, shortcut = true, ...props }: DataTableFilterProps) {
  const { table } = useDataTable();
  const column = table.getColumn(columnId);
  const value = filterValueOf(column) ?? "";
  const inputRef = useRef<HTMLInputElement>(null);
  const accessibleLabel =
    props["aria-label"] ?? (isString(props.placeholder) ? props.placeholder : "Search table");

  useEffect(() => {
    if (!shortcut) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcut]);

  return (
    <div className={cn("w-64 shrink-0", className)} data-slot="data-table-filter">
      <InputGroup>
        <InputGroupInput
          size="sm"
          {...props}
          aria-keyshortcuts={shortcut ? "/" : undefined}
          aria-label={accessibleLabel}
          onChange={(event) => column?.setFilterValue(event.target.value)}
          onKeyDown={(event) => {
            props.onKeyDown?.(event);
            if (event.defaultPrevented || event.key !== "Escape") return;
            if (value) column?.setFilterValue("");
            else event.currentTarget.blur();
          }}
          ref={inputRef}
          role="searchbox"
          type="search"
          value={value}
        />
        <InputGroupAddon align="inline-start">
          <HugeiconsIcon aria-hidden="true" icon={Search01Icon} />
        </InputGroupAddon>
        {value ? (
          <InputGroupAddon align="inline-end">
            <Button
              aria-label="Clear search"
              onClick={() => {
                column?.setFilterValue("");
                inputRef.current?.focus();
              }}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} />
            </Button>
          </InputGroupAddon>
        ) : shortcut ? (
          <InputGroupAddon align="inline-end">
            <Kbd>/</Kbd>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
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
          <Button
            aria-label="Toggle columns"
            className={className}
            size="icon-sm"
            variant="outline"
            {...props}
          >
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
  column: Pick<DataTableColumn, "getCanSort" | "getIsSorted" | "getToggleSortingHandler">;
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
  const { table, onRowClick, onRowPreload } = useDataTable();
  const rows = table.getRowModel().rows;
  return (
    <div
      className="flex w-full flex-col **:data-[slot=table-head]:bg-background **:data-[slot=table-head]:bg-linear-to-b **:data-[slot=table-head]:from-muted/72 **:data-[slot=table-head]:to-muted/72"
      data-slot="data-table-content"
    >
      <Frame
        className={cn(
          "w-full *:data-[slot=table-container]:overflow-x-visible **:data-[slot=table-head]:sticky **:data-[slot=table-head]:top-10 **:data-[slot=table-head]:z-10",
          className,
        )}
        {...props}
      >
        <Table variant="card">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead className="h-8" colSpan={header.colSpan} key={header.id}>
                    {header.isPlaceholder ? null : columnAlign(header.column) === "end" ? (
                      <div className="flex justify-end text-end">
                        <table.FlexRender header={header} />
                      </div>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell className="h-24" colSpan={table.getAllLeafColumns().length}>
                  <p className="text-center text-muted-foreground">No results.</p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  className={cn(onRowClick && "cursor-pointer")}
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onPointerEnter={onRowPreload ? () => onRowPreload(row) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {columnAlign(cell.column) === "end" ? (
                        <div className="text-end tabular-nums">
                          <table.FlexRender cell={cell} />
                        </div>
                      ) : (
                        <table.FlexRender cell={cell} />
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {children}
      </Frame>
    </div>
  );
}

function DataTablePagination({
  className,
  pageSizes,
  ...props
}: React.ComponentProps<"div"> & { pageSizes: ReadonlyArray<number> }) {
  const { table } = useDataTable();
  const { pageIndex, pageSize } = table.state.pagination;
  const rowCount = table.getRowCount();
  const firstResult = pageIndex * pageSize + 1;
  const lastResult = Math.min((pageIndex + 1) * pageSize, rowCount);
  const sizes = [...new Set<number>([...pageSizes, pageSize])].sort((a, b) => a - b);

  return (
    <div className={cn("flex items-center justify-between gap-2", className)} {...props}>
      <p className="text-xs text-muted-foreground tabular-nums">
        {rowCount === 0
          ? formatCount(0, "result")
          : `${formatNumber(firstResult)}–${formatNumber(lastResult)} of ${formatNumber(rowCount)}`}
      </p>
      <div className="flex items-center gap-2">
        <Select
          onValueChange={(value) => table.setPageSize(Number(value))}
          value={String(pageSize)}
        >
          <SelectTrigger aria-label="Rows per page" className="w-auto min-w-0" size="sm">
            <SelectValue>{() => `${pageSize} / page`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {sizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} / page
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Pagination className="w-auto">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                className="sm:*:[svg]:hidden"
                render={
                  <Button
                    disabled={!table.getCanPreviousPage()}
                    onClick={() => table.previousPage()}
                    size="sm"
                    type="button"
                    variant="outline"
                  />
                }
              />
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                className="sm:*:[svg]:hidden"
                render={
                  <Button
                    disabled={!table.getCanNextPage()}
                    onClick={() => table.nextPage()}
                    size="sm"
                    type="button"
                    variant="outline"
                  />
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}

export type { ListTableFeatures };

export {
  DataTable,
  DataTableColumnHeader,
  DataTableContent,
  DataTableFilterMenu,
  DataTableFilterOption,
  DataTableFooter,
  DataTableFilter,
  DataTablePagination,
  DataTableViewOptions,
  listTableFeatures,
};
