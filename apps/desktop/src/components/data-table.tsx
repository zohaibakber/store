import type { ReactTable, Row, RowData, TableFeatures } from "@tanstack/react-table";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeftDoubleIcon,
  ArrowRight01Icon,
  ArrowRightDoubleIcon,
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
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
//     <DataTableFilter columnId="name" placeholder="Filter…" />
//     <DataTableViewOptions />
//     <DataTableContent />
//     <DataTablePagination />
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

interface DataTableHeader {
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
  getHeaderGroups(): ReadonlyArray<{ id: string; headers: ReadonlyArray<DataTableHeader> }>;
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
      <div
        className={cn("flex w-full flex-col gap-3", className)}
        data-slot="data-table"
        {...props}
      />
    </DataTableContext>
  );
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
          <InputGroupButton
            aria-label="Clear search"
            onClick={() => column?.setFilterValue("")}
            size="icon-xs"
          >
            <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} strokeWidth={2} />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

function DataTableViewOptions({ className, ...props }: React.ComponentProps<typeof Button>) {
  const { table } = useDataTable();
  const columns = table.getAllColumns().filter((column) => column.getCanHide());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button className={cn("ml-auto", className)} size="sm" variant="outline" {...props}>
            <HugeiconsIcon aria-hidden="true" icon={ColumnsThreeCogIcon} />
            View
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {columns.map((column) => (
            <DropdownMenuCheckboxItem
              checked={column.getIsVisible()}
              key={column.id}
              onCheckedChange={(checked) => column.toggleVisibility(checked)}
            >
              {column.columnDef.meta?.label ?? column.id}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
  return (
    <Button
      className={cn("-ml-2 cursor-pointer", className)}
      onClick={column.getToggleSortingHandler()}
      size="sm"
      type="button"
      variant="ghost"
    >
      {title}
      {sorted === "asc" ? (
        <HugeiconsIcon aria-hidden="true" icon={ArrowUp01Icon} />
      ) : sorted === "desc" ? (
        <HugeiconsIcon aria-hidden="true" icon={ArrowDown01Icon} />
      ) : (
        <HugeiconsIcon aria-hidden="true" icon={UnfoldMoreIcon} className="text-muted-foreground" />
      )}
    </Button>
  );
}

function DataTableContent({ className, ...props }: React.ComponentProps<"div">) {
  const { table, onRowClick } = useDataTable();
  const rows = table.getRowModel().rows;
  return (
    <div className={cn("overflow-hidden rounded-md border", className)} {...props}>
      <Table>
        <TableHeader className="bg-muted">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
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
    </div>
  );
}

const pageSizes = [10, 20, 30, 50];

function DataTablePagination({ className, ...props }: React.ComponentProps<"div">) {
  const { table } = useDataTable();
  const { pageIndex, pageSize } = table.state.pagination ?? { pageIndex: 0, pageSize: 10 };
  const pageCount = Math.max(table.getPageCount(), 1);
  return (
    <div className={cn("flex items-center justify-between gap-4", className)} {...props}>
      <p className="text-xs text-muted-foreground">
        {table.getRowCount()} row{table.getRowCount() === 1 ? "" : "s"}
      </p>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Rows per page</span>
          <Select
            onValueChange={(value) => table.setPageSize(Number(value))}
            value={String(pageSize)}
          >
            <SelectTrigger aria-label="Rows per page" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-muted-foreground">
          Page {pageIndex + 1} of {pageCount}
        </span>
        <div className="flex items-center gap-1">
          <Button
            aria-label="First page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.firstPage()}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <HugeiconsIcon aria-hidden="true" icon={ArrowLeftDoubleIcon} />
          </Button>
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
          <Button
            aria-label="Last page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.lastPage()}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <HugeiconsIcon aria-hidden="true" icon={ArrowRightDoubleIcon} />
          </Button>
        </div>
      </div>
    </div>
  );
}

export {
  DataTable,
  DataTableColumnHeader,
  DataTableContent,
  DataTableFilter,
  DataTablePagination,
  DataTableViewOptions,
  useDataTable,
};
