/**
 * Transitional TanStack Table v8 compatibility boundary.
 *
 * TanStack Table 9 ships its v8 API as an explicit legacy entrypoint. Keeping
 * the compatibility names here lets existing tables move to the supported
 * package without spreading deprecated imports throughout product code. New
 * and subsequently refactored tables should use the v9 feature API directly.
 */
import type {
  ColumnVisibilityState,
  FilterFn as CoreFilterFn,
  RowData,
  StockFeatures,
} from "@tanstack/react-table";

export { flexRender } from "@tanstack/react-table";
export type {
  ColumnFiltersState,
  RowData,
  SortingState,
} from "@tanstack/react-table";
export {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useLegacyTable as useReactTable,
} from "@tanstack/react-table/legacy";
export type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";

export type VisibilityState = ColumnVisibilityState;
export type FilterFn<TData extends RowData> = CoreFilterFn<
  StockFeatures,
  TData
>;
