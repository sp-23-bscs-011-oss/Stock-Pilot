import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "../auth/authContext";
import { canManageCatalog } from "../auth/permissions";
import { Alert } from "../components/Alert";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { PageLoader } from "../components/PageLoader";
import { Pagination } from "../components/Pagination";
import { AdjustStockDialog } from "../components/inventory/AdjustStockDialog";
import { formatQuantityChange } from "../components/inventory/inventoryLabels";
import { MovementHistory } from "../components/inventory/MovementHistory";
import { StockTable } from "../components/inventory/StockTable";
import { usePageTitle } from "../hooks/usePageTitle";
import { useSearchParamsUpdater } from "../hooks/useSearchParamsUpdater";
import { queryKeys } from "../lib/queryKeys";
import { toApiError } from "../services/apiError";
import { categoryService } from "../services/catalogService";
import { inventoryService, storeService } from "../services/inventoryService";
import type { SortOrder } from "../types/catalog";
import type {
  InventoryItem,
  InventoryListParams,
  InventorySortField,
  InventorySummary,
  StockStatusFilter,
  Store,
} from "../types/inventory";

const PAGE_SIZES = [10, 20, 50, 100];
const SORT_FIELDS: InventorySortField[] = ["name", "sku", "quantity", "reorderThreshold", "updatedAt"];
const STATUS_FILTERS: StockStatusFilter[] = ["all", "needs_reorder", "low", "out", "ok"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE_KEY = "stockpilot.inventory.store";

// Remembering the last store is a per-browser convenience; storage may be unavailable.
function rememberedStore(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}
function rememberStore(id: string) {
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    /* ignore */
  }
}

function readStockParams(search: URLSearchParams, storeId: string): InventoryListParams {
  const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
    value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  const page = Number(search.get("page"));
  const pageSize = Number(search.get("pageSize"));
  const category = search.get("category");
  return {
    storeId,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 20,
    search: search.get("q")?.trim() || undefined,
    categoryId: category === "none" || (category && UUID_PATTERN.test(category)) ? category : undefined,
    stockStatus: pick(search.get("status"), STATUS_FILTERS, "all"),
    sort: pick(search.get("sort"), SORT_FIELDS, "name"),
    order: pick(search.get("order"), ["asc", "desc"] as const, "asc") as SortOrder,
  };
}

export default function InventoryPage() {
  usePageTitle("Inventory");
  const user = useCurrentUser();
  const canManage = canManageCatalog(user.role);
  const [searchParams, updateParams] = useSearchParamsUpdater();

  const storesQuery = useQuery({
    queryKey: queryKeys.stores(),
    queryFn: ({ signal }) => storeService.list({}, signal),
    staleTime: 5 * 60_000,
  });
  const stores = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);

  // Store: from the URL, else the one used last time, else the first active store.
  const requested = searchParams.get("store") ?? rememberedStore();
  const store = stores.find((s) => s.id === requested) ?? stores[0];
  useEffect(() => {
    if (store) rememberStore(store.id);
  }, [store]);

  const tab = canManage && searchParams.get("tab") === "history" ? "history" : "stock";

  return (
    <section>
      <PageHeader
        title="Inventory"
        description={canManage ? "On-hand stock per store, with every change recorded." : "Check what's on hand in each store."}
        actions={
          stores.length > 1 && store ? (
            <label className="toolbar__filter">
              <span className="visually-hidden">Store</span>
              <select value={store.id} onChange={(event) => updateParams({ store: event.target.value })}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : store ? (
            <span className="store-pill">{store.name}</span>
          ) : null
        }
      />

      {storesQuery.isPending ? (
        <PageLoader message="Loading stores…" />
      ) : storesQuery.isError ? (
        <ErrorState title="Couldn't load stores" message={toApiError(storesQuery.error).message} onRetry={() => void storesQuery.refetch()} />
      ) : !store ? (
        <div className="empty-state">
          <p className="empty-state__title">No active stores</p>
          <p className="empty-state__text">The owner can add or reactivate a store in Settings.</p>
        </div>
      ) : (
        <>
          {canManage && (
            <div className="tabs" role="tablist" aria-label="Inventory views">
              {(["stock", "history"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  className={`tabs__tab${tab === value ? " is-active" : ""}`}
                  onClick={() => updateParams({ tab: value === "stock" ? undefined : value, historyProduct: undefined })}
                >
                  {value === "stock" ? "Stock levels" : "Movement history"}
                </button>
              ))}
            </div>
          )}
          {tab === "stock" ? (
            <StockLevels key={store.id} store={store} canManage={canManage} />
          ) : (
            <HistoryTab key={store.id} store={store} />
          )}
        </>
      )}
    </section>
  );
}

function HistoryTab({ store }: { store: Store }) {
  const [searchParams, updateParams] = useSearchParamsUpdater();
  const productId = searchParams.get("historyProduct");
  const productName = searchParams.get("historyName");
  const product = productId && UUID_PATTERN.test(productId) ? { id: productId, name: productName ?? "Selected product" } : null;

  return (
    <MovementHistory
      key={product?.id ?? "all"}
      storeId={store.id}
      product={product}
      onClearProduct={() => updateParams({ historyProduct: undefined, historyName: undefined })}
    />
  );
}

function StockLevels({ store, canManage }: { store: Store; canManage: boolean }) {
  const [searchParams, updateParams] = useSearchParamsUpdater();
  const params = useMemo(() => readStockParams(searchParams, store.id), [searchParams, store.id]);

  const [searchText, setSearchText] = useState(params.search ?? "");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  function changeSearch(text: string) {
    setSearchText(text);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => updateParams({ q: text.trim() || undefined }), 300);
  }

  const query = useQuery({
    queryKey: queryKeys.inventory.list(params),
    queryFn: ({ signal }) => inventoryService.list(params, signal),
    placeholderData: keepPreviousData,
  });
  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories,
    queryFn: ({ signal }) => categoryService.list(signal),
    staleTime: 5 * 60_000,
  });

  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const data = query.data;
  useEffect(() => {
    if (data && params.page > data.totalPages) updateParams({ page: data.totalPages > 1 ? data.totalPages : undefined });
  }, [data, params.page, updateParams]);

  const filtersActive = Boolean(params.search || params.categoryId || params.stockStatus !== "all");
  const clearFilters = () => {
    clearTimeout(searchTimer.current);
    setSearchText("");
    updateParams({ q: undefined, category: undefined, status: undefined });
  };

  return (
    <div>
      {data && <SummaryTiles summary={data.summary} active={params.stockStatus} onFilter={(status) => updateParams({ status })} />}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="toolbar" role="search">
        <label className="toolbar__search">
          <span className="visually-hidden">Search stock</span>
          <input
            type="search"
            placeholder="Search name, SKU or barcode…"
            value={searchText}
            onChange={(event) => changeSearch(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="toolbar__filter">
          <span className="visually-hidden">Category</span>
          <select value={params.categoryId ?? ""} onChange={(event) => updateParams({ category: event.target.value })}>
            <option value="">All categories</option>
            <option value="none">Uncategorized</option>
            {(categoriesQuery.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__filter">
          <span className="visually-hidden">Stock status</span>
          <select
            value={params.stockStatus}
            onChange={(event) => updateParams({ status: event.target.value === "all" ? undefined : event.target.value })}
          >
            <option value="all">All stock levels</option>
            <option value="needs_reorder">Needs reorder</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
            <option value="ok">In stock</option>
          </select>
        </label>
        {filtersActive && (
          <button type="button" className="button button--ghost button--sm" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {query.isPending ? (
        <PageLoader message="Loading stock…" />
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load stock"
          message={toApiError(query.error).message}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.data.total === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">{filtersActive ? "Nothing matches these filters" : "No products to track yet"}</p>
          {filtersActive ? (
            <button type="button" className="button button--ghost" onClick={clearFilters}>
              Clear filters
            </button>
          ) : (
            <p className="empty-state__text">Products added to the catalog appear here with their stock.</p>
          )}
        </div>
      ) : (
        <div className={query.isPlaceholderData ? "is-refreshing" : undefined} aria-busy={query.isFetching}>
          <StockTable
            items={query.data.items}
            sort={params.sort}
            order={params.order}
            onSort={(field) =>
              updateParams({ sort: field, order: params.sort === field && params.order === "asc" ? "desc" : "asc" })
            }
            canManage={canManage}
            onAdjust={(item) => {
              setNotice(null);
              setAdjusting(item);
            }}
            onHistory={(item) => updateParams({ tab: "history", historyProduct: item.productId, historyName: item.name })}
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
            itemLabel="products"
          />
        </div>
      )}

      {canManage && (
        <AdjustStockDialog
          item={adjusting}
          store={store}
          onClose={() => setAdjusting(null)}
          onAdjusted={({ movement }) => {
            setAdjusting(null);
            setNotice(
              `${movement.product.name}: ${formatQuantityChange(movement.quantityChange)} (now ${movement.quantityAfter} on hand).`,
            );
          }}
        />
      )}
    </div>
  );
}

function SummaryTiles({
  summary,
  active,
  onFilter,
}: {
  summary: InventorySummary;
  active: StockStatusFilter;
  onFilter: (status: StockStatusFilter | undefined) => void;
}) {
  const tiles: { label: string; value: number; status?: StockStatusFilter; tone?: string }[] = [
    { label: "Products", value: summary.products },
    { label: "Units on hand", value: summary.units },
    { label: "Low stock", value: summary.low, status: "low", tone: summary.low > 0 ? "warn" : undefined },
    { label: "Out of stock", value: summary.out, status: "out", tone: summary.out > 0 ? "danger" : undefined },
  ];

  return (
    <div className="summary-tiles">
      {tiles.map((tile) =>
        tile.status ? (
          <button
            key={tile.label}
            type="button"
            className={`summary-tile summary-tile--button${active === tile.status ? " is-active" : ""}`}
            onClick={() => onFilter(active === tile.status ? undefined : tile.status)}
            aria-pressed={active === tile.status}
          >
            <span className="summary-tile__label">{tile.label}</span>
            <span className={`summary-tile__value${tile.tone ? ` summary-tile__value--${tile.tone}` : ""}`}>
              {tile.value.toLocaleString()}
            </span>
          </button>
        ) : (
          <div key={tile.label} className="summary-tile">
            <span className="summary-tile__label">{tile.label}</span>
            <span className="summary-tile__value">{tile.value.toLocaleString()}</span>
          </div>
        ),
      )}
    </div>
  );
}
