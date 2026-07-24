import type { ReactTable, Row, RowData, TableFeatures } from "@tanstack/react-table";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  ColumnsThreeCogIcon,
  Search01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createContext, use } from "react";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { Frame, FrameFooter } from "@/components/ui/frame";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
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

// Compound component around a TanStack Table v9 instance. The provider carries
// the table (its state and actions) so every subcomponent reads it via context;
// pages compose only the pieces they need:
//
//   <DataTable table={table} onRowClick={(row) => …}>
//     <DataTableHeader>
//       <DataTableFilter columnId="name" placeholder="Filter…" />
//       <DataTableViewOptions />
//     </DataTableHeader>
//     <DataTableContent />
//     <DataTableFooter>
//       <DataTablePagination />
//     </DataTableFooter>
//   </DataTable>
//
// The context exposes a structural interface covering only what the
// subcomponents consume (v9 table types are parameterized over the registered
// feature set, so a concrete instance is narrower than `ReactTable<any, any>`
// and would not be assignable to it). Any table created with the filtering,
// visibility, pagination and sorting features satisfies this contract.
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
  getFilterValue(): unknown;
  setFilterValue(value: unknown): void;
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

function DataTableFilter({ columnId, className, ...props }: DataTableFilterProps) {
  const { table } = useDataTable();
  const column = table.getColumn(columnId);
  const value = (column?.getFilterValue() as string | undefined) ?? "";
  return (
    <InputGroup className={cn("max-w-64", className)}>
      <InputGroupInput
        onChange={(event) => column?.setFilterValue(event.target.value)}
        role="searchbox"
        type="text"
        value={value}
        {...props}
      />
      <InputGroupAddon align="inline-start">
        <HugeiconsIcon aria-hidden="true" icon={Search01Icon} strokeWidth={2} />
      </InputGroupAddon>
      {value && (
        <InputGroupAddon align="inline-end">
          <Button
            aria-label="Clear search"
            onClick={() => column?.setFilterValue("")}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} strokeWidth={2} />
          </Button>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

function DataTableViewOptions({ className, ...props }: React.ComponentProps<typeof Button>) {
  const { table } = useDataTable();
  const columns = table.getAllColumns().filter((column) => column.getCanHide());
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button className={cn("ml-auto", className)} size="icon" variant="ghost" {...props}>
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
      className={cn("flex h-full cursor-pointer select-none items-center gap-2", className)}
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
          <SelectTrigger aria-label="Displayed result range" size="sm">
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
          size="icon-sm"
          type="button"
          variant="outline"
        >
          <HugeiconsIcon aria-hidden="true" icon={ArrowLeft01Icon} />
        </Button>
        <Button
          aria-label="Next page"
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
          size="icon-sm"
          type="button"
          variant="outline"
        >
          <HugeiconsIcon aria-hidden="true" icon={ArrowRight01Icon} />
        </Button>
      </div>
    </div>
  );
}

export {
  DataTable,
  DataTableColumnHeader,
  DataTableContent,
  DataTableFooter,
  DataTableFilter,
  DataTableHeader,
  DataTablePagination,
  DataTableViewOptions,
  useDataTable,
};
