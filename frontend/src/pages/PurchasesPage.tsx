import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { z } from "zod";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { PurchasingSkeleton as PageLoader } from "../components/purchasing/PurchasingSkeleton";
import { Pagination } from "../components/Pagination";
import { PurchaseOrderTable } from "../components/purchasing/PurchaseOrderTable";
import { ORDER_STATUSES, statusLabels, dayBoundary } from "../components/purchasing/purchasingLabels";
import { usePageTitle } from "../hooks/usePageTitle";
import { useSearchParamsUpdater } from "../hooks/useSearchParamsUpdater";
import { queryKeys } from "../lib/queryKeys";
import { newPurchaseOrderPath, paths } from "../routes/paths";
import { toApiError } from "../services/apiError";
import { storeService } from "../services/inventoryService";
import { purchaseOrderService, supplierService } from "../services/purchasingService";
import type { SortOrder } from "../types/catalog";
import type { PurchaseOrderListParams, PurchaseOrderSortField, PurchaseOrderStatus } from "../types/purchasing";

const PAGE_SIZES = [10, 20, 50, 100];
const SORT_FIELDS: PurchaseOrderSortField[] = ["number", "createdAt", "expectedAt", "total"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "open" is a pseudo-status: ordered or partially received, i.e. still expecting goods. */
type StatusTab = "all" | "open" | PurchaseOrderStatus;
const TABS: StatusTab[] = ["all", "open", ...ORDER_STATUSES];

function readParams(search: URLSearchParams): PurchaseOrderListParams & { tab: StatusTab } {
  const page = Number(search.get("page"));
  const pageSize = Number(search.get("pageSize"));
  const tab = (TABS as string[]).includes(search.get("status") ?? "") ? (search.get("status") as StatusTab) : "all";
  const sort = search.get("sort") as PurchaseOrderSortField | null;
  const uuid = (key: string) => {
    const value = search.get(key);
    return value && UUID_PATTERN.test(value) ? value : undefined;
  };
  return {
    tab,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 20,
    search: search.get("q")?.trim() || undefined,
    status: tab === "all" || tab === "open" ? undefined : tab,
    open: tab === "open" ? "true" : undefined,
    supplierId: uuid("supplier"),
    storeId: uuid("store"),
    from: z.iso.date().safeParse(search.get("from")).success ? dayBoundary(search.get("from")!, false) : undefined,
    to: z.iso.date().safeParse(search.get("to")).success ? dayBoundary(search.get("to")!, true) : undefined,
    sort: sort && SORT_FIELDS.includes(sort) ? sort : "number",
    order: search.get("order") === "asc" ? "asc" : ("desc" as SortOrder),
  };
}

export default function PurchasesPage({ history = false }: { history?: boolean }) {
  usePageTitle(history ? "Purchase history" : "Purchases");
  const [searchParams, updateParams] = useSearchParamsUpdater();
  const { tab, ...params } = useMemo(() => readParams(searchParams), [searchParams]);

  const [searchText, setSearchText] = useState(params.search ?? "");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  function changeSearch(text: string) {
    setSearchText(text);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => updateParams({ q: text.trim() || undefined }), 300);
  }

  const query = useQuery({
    queryKey: queryKeys.purchaseOrders.list(params),
    queryFn: ({ signal }) => purchaseOrderService.list(params, signal),
    placeholderData: keepPreviousData,
  });
  const suppliersQuery = useQuery({
    queryKey: [...queryKeys.suppliers.options, "all"],
    queryFn: ({ signal }) => supplierService.options("all", signal),
    staleTime: 60_000,
  });
  const storesQuery = useQuery({
    queryKey: queryKeys.stores(true),
    queryFn: ({ signal }) => storeService.list({ includeInactive: true }, signal),
    staleTime: 5 * 60_000,
  });

  const data = query.data;
  useEffect(() => {
    if (data && params.page > data.totalPages) updateParams({ page: data.totalPages > 1 ? data.totalPages : undefined });
  }, [data, params.page, updateParams]);

  const counts = data?.statusCounts;
  const tabCount = (value: StatusTab) => {
    if (!counts) return null;
    if (value === "all") return Object.values(counts).reduce((sum, n) => sum + n, 0);
    if (value === "open") return counts.ORDERED + counts.PARTIALLY_RECEIVED;
    return counts[value];
  };

  const filtersActive = Boolean(params.search || params.supplierId || params.storeId || params.from || params.to);
  const clearFilters = () => {
    clearTimeout(searchTimer.current);
    setSearchText("");
    updateParams({ q: undefined, supplier: undefined, store: undefined, from: undefined, to: undefined });
  };

  return (
    <section>
      <PageHeader
        title={history ? "Purchase history" : "Purchases"}
        description={history ? "Review orders, deliveries and payment balances by supplier and date." : "Order stock from suppliers and receive it into inventory."}
        actions={
          <>
          <Link className="button button--ghost" to={history ? paths.purchases : `${paths.purchases}/history`}>
            {history ? "Purchase orders" : "Purchase history"}
          </Link>
          <Link className="button" to={newPurchaseOrderPath()}>
            New purchase order
          </Link>
          </>
        }
      />

      <div className="tabs tabs--scroll" role="tablist" aria-label="Order status">
        {TABS.map((value) => {
          const count = tabCount(value);
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={`tabs__tab${tab === value ? " is-active" : ""}`}
              onClick={() => updateParams({ status: value === "all" ? undefined : value })}
            >
              {value === "all" ? "All" : value === "open" ? "Awaiting delivery" : statusLabels[value]}
              {count !== null && <span className="tabs__count">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="toolbar" role="search">
        <label className="toolbar__search">
          <span className="visually-hidden">Search orders</span>
          <input
            type="search"
            placeholder="Search order number, supplier, product or SKU…"
            value={searchText}
            onChange={(event) => changeSearch(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="toolbar__filter">
          <span className="visually-hidden">Supplier</span>
          <select value={params.supplierId ?? ""} onChange={(event) => updateParams({ supplier: event.target.value })}>
            <option value="">All suppliers</option>
            {(suppliersQuery.data ?? []).map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
                {supplier.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </label>
        {(storesQuery.data?.length ?? 0) > 1 && (
          <label className="toolbar__filter">
            <span className="visually-hidden">Store</span>
            <select value={params.storeId ?? ""} onChange={(event) => updateParams({ store: event.target.value })}>
              <option value="">All stores</option>
              {(storesQuery.data ?? []).map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {filtersActive && (
          <button type="button" className="button button--ghost button--sm" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <div className="toolbar">
        <label className="toolbar__date"><span>Created from</span>
          <input type="date" value={searchParams.get("from") ?? ""} max={searchParams.get("to") || undefined}
            onChange={(event) => updateParams({ from: event.target.value || undefined })} />
        </label>
        <label className="toolbar__date"><span>Created to</span>
          <input type="date" value={searchParams.get("to") ?? ""} min={searchParams.get("from") || undefined}
            onChange={(event) => updateParams({ to: event.target.value || undefined })} />
        </label>
      </div>

      {query.isPending ? (
        <PageLoader message="Loading purchase orders…" />
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load purchase orders"
          message={toApiError(query.error).message}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.data.total === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">
            {filtersActive || tab !== "all" ? "No orders match these filters" : "No purchase orders yet"}
          </p>
          {filtersActive ? (
            <button type="button" className="button button--ghost" onClick={clearFilters}>
              Clear filters
            </button>
          ) : (
            <p className="empty-state__text">Create a purchase order, mark it as ordered, then receive the stock when it arrives.</p>
          )}
        </div>
      ) : (
        <div className={query.isPlaceholderData ? "is-refreshing" : undefined} aria-busy={query.isFetching}>
          <PurchaseOrderTable
            orders={query.data.items}
            sort={params.sort}
            order={params.order}
            onSort={(field) =>
              updateParams({ sort: field, order: params.sort === field && params.order === "desc" ? "asc" : "desc" })
            }
          />
          <Pagination
            page={params.page}
            totalPages={query.data.totalPages}
            total={query.data.total}
            pageSize={params.pageSize}
            pageSizeOptions={PAGE_SIZES}
            onPageChange={(page) => updateParams({ page: page > 1 ? page : undefined })}
            onPageSizeChange={(pageSize) => updateParams({ pageSize: pageSize === 20 ? undefined : pageSize })}
            busy={query.isPlaceholderData}
            itemLabel="orders"
          />
        </div>
      )}
    </section>
  );
}
