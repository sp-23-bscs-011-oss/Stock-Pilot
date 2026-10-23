import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "../auth/authContext";
import { canManageCatalog } from "../auth/permissions";
import { Alert } from "../components/Alert";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { PageLoader } from "../components/PageLoader";
import { Pagination } from "../components/Pagination";
import { CategoryManagerDialog } from "../components/products/CategoryManagerDialog";
import { ProductFormDialog } from "../components/products/ProductFormDialog";
import { ProductTable } from "../components/products/ProductTable";
import { usePageTitle } from "../hooks/usePageTitle";
import { useSearchParamsUpdater } from "../hooks/useSearchParamsUpdater";
import { queryKeys } from "../lib/queryKeys";
import { toApiError } from "../services/apiError";
import { categoryService, productService } from "../services/catalogService";
import type { Product, ProductListParams, ProductSortField, ProductStatusFilter, SortOrder } from "../types/catalog";

const SORT_FIELDS: ProductSortField[] = ["name", "sku", "sellingPrice", "costPrice", "reorderThreshold", "createdAt", "updatedAt"];
const PAGE_SIZES = [10, 20, 50, 100];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULTS = { page: 1, pageSize: 20, status: "active", sort: "name", order: "asc" } as const;

const SORT_OPTIONS: { value: `${ProductSortField}:${SortOrder}`; label: string; managersOnly?: boolean }[] = [
  { value: "name:asc", label: "Name (A–Z)" },
  { value: "name:desc", label: "Name (Z–A)" },
  { value: "sellingPrice:asc", label: "Price (low to high)" },
  { value: "sellingPrice:desc", label: "Price (high to low)" },
  { value: "costPrice:desc", label: "Cost (high to low)", managersOnly: true },
  { value: "sku:asc", label: "SKU" },
  { value: "createdAt:desc", label: "Newest first" },
  { value: "updatedAt:desc", label: "Recently updated" },
];

/** List state lives in the URL, so filters survive reloads, can be shared, and work with Back. */
function readParams(search: URLSearchParams, canManage: boolean): ProductListParams {
  const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
    value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  const page = Number(search.get("page"));
  const pageSize = Number(search.get("pageSize"));
  const category = search.get("category");

  const statuses: ProductStatusFilter[] = canManage ? ["active", "archived", "all"] : ["active"];
  const sorts = canManage ? SORT_FIELDS : SORT_FIELDS.filter((field) => field !== "costPrice");

  return {
    page: Number.isInteger(page) && page > 0 ? page : DEFAULTS.page,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULTS.pageSize,
    search: search.get("q")?.trim() || undefined,
    // Ignore hand-edited values the API would reject.
    categoryId: category === "none" || (category && UUID_PATTERN.test(category)) ? category : undefined,
    status: pick(search.get("status"), statuses, DEFAULTS.status),
    sort: pick(search.get("sort"), sorts, DEFAULTS.sort),
    order: pick(search.get("order"), ["asc", "desc"] as const, DEFAULTS.order),
  };
}

export default function ProductsPage() {
  usePageTitle("Products");
  const user = useCurrentUser();
  const canManage = canManageCatalog(user.role);
  const queryClient = useQueryClient();

  const [searchParams, updateParams] = useSearchParamsUpdater();
  const params = useMemo(() => readParams(searchParams, canManage), [searchParams, canManage]);

  // The search box updates instantly; the query (and URL) follow once typing pauses.
  const [searchText, setSearchText] = useState(params.search ?? "");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  function changeSearch(text: string) {
    setSearchText(text);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => updateParams({ q: text.trim() || undefined }), 300);
  }

  const productsQuery = useQuery({
    queryKey: queryKeys.products.list(params),
    queryFn: ({ signal }) => productService.list(params, signal),
    // Keep showing the current page while the next one loads, instead of flashing a spinner.
    placeholderData: keepPreviousData,
  });
  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories,
    queryFn: ({ signal }) => categoryService.list(signal),
    staleTime: 5 * 60_000,
  });
  const categories = categoriesQuery.data ?? [];

  const [formState, setFormState] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const refreshCatalog = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
    void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
  };

  const archive = useMutation({
    mutationFn: (product: Product) => productService.archive(product.id),
    onSuccess: (product) => {
      setArchiveTarget(null);
      setNotice({ tone: "success", text: `“${product.name}” was archived. Past sales keep their records; you can restore it any time.` });
      refreshCatalog();
    },
  });

  const restore = useMutation({
    mutationFn: (product: Product) => productService.restore(product.id),
    onSuccess: (product) => {
      setNotice({ tone: "success", text: `“${product.name}” is active again.` });
      refreshCatalog();
    },
    onError: (error) => setNotice({ tone: "error", text: toApiError(error).message }),
  });

  // If the current page no longer exists (e.g. the last item on it was archived), step back.
  const data = productsQuery.data;
  useEffect(() => {
    if (data && params.page > data.totalPages) updateParams({ page: data.totalPages > 1 ? data.totalPages : undefined });
  }, [data, params.page, updateParams]);

  const filtersActive = Boolean(params.search || params.categoryId || params.status !== DEFAULTS.status);
  const clearFilters = () => {
    clearTimeout(searchTimer.current);
    setSearchText("");
    updateParams({ q: undefined, category: undefined, status: undefined });
  };

  function toggleSort(field: ProductSortField) {
    const order = params.sort === field && params.order === "asc" ? "desc" : "asc";
    updateParams({ sort: field, order });
  }

  return (
    <section>
      <PageHeader
        title="Products"
        description={
          canManage
            ? "Your catalog: what you sell, what it costs, and when to reorder."
            : "Look up products, prices and barcodes."
        }
        actions={
          canManage && (
            <>
              <button type="button" className="button button--ghost" onClick={() => setCategoriesOpen(true)}>
                Categories
              </button>
              <button type="button" className="button" onClick={() => setFormState({ open: true, product: null })}>
                New product
              </button>
            </>
          )
        }
      />

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="toolbar" role="search">
        <label className="toolbar__search">
          <span className="visually-hidden">Search products</span>
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
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        {canManage && (
          <label className="toolbar__filter">
            <span className="visually-hidden">Status</span>
            <select
              value={params.status}
              onChange={(event) => updateParams({ status: event.target.value === DEFAULTS.status ? undefined : event.target.value })}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All products</option>
            </select>
          </label>
        )}
        <label className="toolbar__filter">
          <span className="visually-hidden">Sort by</span>
          <select
            value={`${params.sort}:${params.order}`}
            onChange={(event) => {
              const [sort, order] = event.target.value.split(":");
              updateParams({ sort, order });
            }}
          >
            {/* Header clicks can produce combinations not in the list; show them too. */}
            {!SORT_OPTIONS.some((option) => option.value === `${params.sort}:${params.order}`) && (
              <option value={`${params.sort}:${params.order}`}>Custom sort</option>
            )}
            {SORT_OPTIONS.filter((option) => canManage || !option.managersOnly).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {filtersActive && (
          <button type="button" className="button button--ghost button--sm" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {productsQuery.isPending ? (
        <PageLoader message="Loading products…" />
      ) : productsQuery.isError ? (
        <ErrorState
          title="Couldn't load products"
          message={toApiError(productsQuery.error).message}
          onRetry={() => void productsQuery.refetch()}
          retrying={productsQuery.isFetching}
        />
      ) : productsQuery.data.total === 0 ? (
        filtersActive ? (
          <div className="empty-state">
            <p className="empty-state__title">No products match these filters</p>
            <button type="button" className="button button--ghost" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="empty-state">
            <p className="empty-state__title">No products yet</p>
            <p className="empty-state__text">
              {canManage ? "Add your first product to start building the catalog." : "A manager hasn't added any products yet."}
            </p>
            {canManage && (
              <button type="button" className="button" onClick={() => setFormState({ open: true, product: null })}>
                New product
              </button>
            )}
          </div>
        )
      ) : (
        <div className={productsQuery.isPlaceholderData ? "is-refreshing" : undefined} aria-busy={productsQuery.isFetching}>
          <ProductTable
            products={productsQuery.data.items}
            sort={params.sort}
            order={params.order}
            onSort={toggleSort}
            showCost={canManage}
            showStatus={params.status !== "active"}
            canManage={canManage}
            onEdit={(product) => setFormState({ open: true, product })}
            onArchive={(product) => {
              archive.reset();
              setArchiveTarget(product);
            }}
            onRestore={(product) => restore.mutate(product)}
            restoringId={restore.isPending ? restore.variables?.id : null}
          />
          <Pagination
            page={params.page}
            totalPages={productsQuery.data.totalPages}
            total={productsQuery.data.total}
            pageSize={params.pageSize}
            pageSizeOptions={PAGE_SIZES}
            onPageChange={(page) => updateParams({ page: page > 1 ? page : undefined })}
            onPageSizeChange={(pageSize) => updateParams({ pageSize: pageSize === DEFAULTS.pageSize ? undefined : pageSize })}
            busy={productsQuery.isPlaceholderData}
            itemLabel="products"
          />
        </div>
      )}

      {canManage && (
        <>
          <ProductFormDialog
            open={formState.open}
            product={formState.product}
            categories={categories}
            onClose={() => setFormState((current) => ({ ...current, open: false }))}
            onSaved={(product, mode) => {
              setFormState({ open: false, product: null });
              setNotice({ tone: "success", text: `“${product.name}” was ${mode}.` });
            }}
          />
          <CategoryManagerDialog open={categoriesOpen} categories={categories} onClose={() => setCategoriesOpen(false)} />
          <ConfirmDialog
            open={archiveTarget !== null}
            title={`Archive “${archiveTarget?.name ?? ""}”?`}
            confirmLabel="Archive product"
            pendingLabel="Archiving…"
            tone="danger"
            pending={archive.isPending}
            error={archive.isError ? toApiError(archive.error).message : null}
            onConfirm={() => archiveTarget && archive.mutate(archiveTarget)}
            onClose={() => setArchiveTarget(null)}
          >
            <p>It will disappear from the catalog and can't be sold or reordered.</p>
            <p>
              Nothing is deleted: past invoices and reports keep showing it, its SKU stays reserved, and you can restore it
              from the <strong>Archived</strong> filter.
            </p>
          </ConfirmDialog>
        </>
      )}
    </section>
  );
}
