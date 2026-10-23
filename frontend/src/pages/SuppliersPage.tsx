import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Alert } from "../components/Alert";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { PageLoader } from "../components/PageLoader";
import { Pagination } from "../components/Pagination";
import { SupplierFormDialog } from "../components/purchasing/SupplierFormDialog";
import { SupplierReportView } from "../components/purchasing/SupplierReportView";
import { usePageTitle } from "../hooks/usePageTitle";
import { useSearchParamsUpdater } from "../hooks/useSearchParamsUpdater";
import { formatMoney } from "../lib/format";
import { queryKeys } from "../lib/queryKeys";
import { formErrorMessage } from "../lib/validation";
import { toApiError } from "../services/apiError";
import { supplierService } from "../services/purchasingService";
import { supplierPath } from "../routes/paths";
import type { Supplier, SupplierListParams, SupplierStatusFilter } from "../types/purchasing";

const PAGE_SIZES = [10, 20, 50, 100];
const STATUS_FILTERS: SupplierStatusFilter[] = ["active", "inactive", "all"];

function readParams(search: URLSearchParams): SupplierListParams {
  const page = Number(search.get("page"));
  const pageSize = Number(search.get("pageSize"));
  const status = search.get("status") as SupplierStatusFilter | null;
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 20,
    search: search.get("q")?.trim() || undefined,
    status: status && STATUS_FILTERS.includes(status) ? status : "active",
    sort: "name",
    order: "asc",
  };
}

export default function SuppliersPage() {
  usePageTitle("Suppliers");
  const [searchParams, updateParams] = useSearchParamsUpdater();
  const tab = searchParams.get("tab") === "report" ? "report" : "list";
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section>
      <PageHeader
        title="Suppliers"
        description="The vendors you buy stock from, and how much you buy from each."
        actions={
          <button
            type="button"
            className="button"
            onClick={() => {
              setNotice(null);
              setEditing("new");
            }}
          >
            New supplier
          </button>
        }
      />

      <div className="tabs" role="tablist" aria-label="Supplier views">
        {(["list", "report"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`tabs__tab${tab === value ? " is-active" : ""}`}
            onClick={() => updateParams({ tab: value === "list" ? undefined : value })}
          >
            {value === "list" ? "All suppliers" : "Purchasing report"}
          </button>
        ))}
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {tab === "list" ? (
        <SupplierList
          onEdit={(supplier) => {
            setNotice(null);
            setEditing(supplier);
          }}
          onNotice={setNotice}
        />
      ) : (
        <SupplierReportView />
      )}

      <SupplierFormDialog
        open={editing !== null}
        supplier={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(supplier, mode) => {
          setEditing(null);
          setNotice(mode === "created" ? `${supplier.name} was added.` : `${supplier.name} was updated.`);
        }}
      />
    </section>
  );
}

function SupplierList({ onEdit, onNotice }: { onEdit: (supplier: Supplier) => void; onNotice: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [searchParams, updateParams] = useSearchParamsUpdater();
  const params = useMemo(() => readParams(searchParams), [searchParams]);

  const [searchText, setSearchText] = useState(params.search ?? "");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  function changeSearch(text: string) {
    setSearchText(text);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => updateParams({ q: text.trim() || undefined }), 300);
  }

  const query = useQuery({
    queryKey: queryKeys.suppliers.list(params),
    queryFn: ({ signal }) => supplierService.list(params, signal),
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  useEffect(() => {
    if (data && params.page > data.totalPages) updateParams({ page: data.totalPages > 1 ? data.totalPages : undefined });
  }, [data, params.page, updateParams]);

  // Deactivate, reactivate or delete, all confirmed first.
  const [confirming, setConfirming] = useState<{ supplier: Supplier; action: "deactivate" | "reactivate" | "delete" } | null>(null);
  const action = useMutation({
    mutationFn: async ({ supplier, action: kind }: NonNullable<typeof confirming>) => {
      if (kind === "delete") await supplierService.remove(supplier.id);
      else await supplierService.update(supplier.id, { isActive: kind === "reactivate" });
    },
    onSuccess: (_result, { supplier, action: kind }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      setConfirming(null);
      onNotice(
        kind === "delete"
          ? `${supplier.name} was deleted.`
          : kind === "deactivate"
            ? `${supplier.name} was deactivated. Its order history is kept.`
            : `${supplier.name} is active again.`,
      );
    },
  });

  const filtersActive = Boolean(params.search || params.status !== "active");
  const clearFilters = () => {
    clearTimeout(searchTimer.current);
    setSearchText("");
    updateParams({ q: undefined, status: undefined });
  };

  return (
    <div>
      <div className="toolbar" role="search">
        <label className="toolbar__search">
          <span className="visually-hidden">Search suppliers</span>
          <input
            type="search"
            placeholder="Search name, contact, email or phone…"
            value={searchText}
            onChange={(event) => changeSearch(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="toolbar__filter">
          <span className="visually-hidden">Status</span>
          <select value={params.status} onChange={(event) => updateParams({ status: event.target.value === "active" ? undefined : event.target.value })}>
            <option value="active">Active suppliers</option>
            <option value="inactive">Inactive suppliers</option>
            <option value="all">All suppliers</option>
          </select>
        </label>
        {filtersActive && (
          <button type="button" className="button button--ghost button--sm" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {query.isPending ? (
        <PageLoader message="Loading suppliers…" />
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load suppliers"
          message={toApiError(query.error).message}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.data.total === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">{filtersActive ? "No suppliers match these filters" : "No suppliers yet"}</p>
          {filtersActive ? (
            <button type="button" className="button button--ghost" onClick={clearFilters}>
              Clear filters
            </button>
          ) : (
            <p className="empty-state__text">Add the vendors you buy from, then raise purchase orders against them.</p>
          )}
        </div>
      ) : (
        <div className={query.isPlaceholderData ? "is-refreshing" : undefined} aria-busy={query.isFetching}>
          <div className="table-wrap">
            <table className="data-table data-table--responsive">
              <thead>
                <tr>
                  <th scope="col">Supplier</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Terms</th>
                  <th scope="col" className="align-end">
                    Open orders
                  </th>
                  <th scope="col" className="align-end">
                    Outstanding
                  </th>
                  <th scope="col" className="align-end">
                    Ordered to date
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((supplier) => (
                  <tr key={supplier.id} className={supplier.isActive ? undefined : "is-muted"}>
                    <td data-label="Supplier" className="data-table__primary">
                      <Link to={supplierPath(supplier.id)} className="cell-primary row-link">
                        {supplier.name}
                      </Link>
                      {!supplier.isActive && <div className="cell-secondary">Inactive</div>}
                    </td>
                    <td data-label="Contact">
                      <div>{supplier.contactName ?? <span className="cell-secondary">—</span>}</div>
                      {(supplier.email || supplier.phone) && (
                        <div className="cell-secondary">{[supplier.email, supplier.phone].filter(Boolean).join(" · ")}</div>
                      )}
                    </td>
                    <td data-label="Terms">{supplier.paymentTerms ?? <span className="cell-secondary">—</span>}</td>
                    <td data-label="Open orders" className="align-end">
                      {supplier.stats.openOrders}
                    </td>
                    <td data-label="Outstanding" className="align-end nowrap">
                      {formatMoney(supplier.stats.outstandingValue)}
                    </td>
                    <td data-label="Ordered to date" className="align-end nowrap">
                      {formatMoney(supplier.stats.orderedValue)}
                    </td>
                    <td className="data-table__actions align-end">
                      <div className="table-actions">
                        <button type="button" className="button button--ghost button--sm" onClick={() => onEdit(supplier)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          onClick={() => {
                            action.reset();
                            setConfirming({
                              supplier,
                              action: !supplier.isActive
                                ? "reactivate"
                                : supplier.stats.orderCount + supplier.stats.draftOrders === 0
                                  ? "delete"
                                  : "deactivate",
                            });
                          }}
                        >
                          {!supplier.isActive ? "Reactivate" : supplier.stats.orderCount + supplier.stats.draftOrders === 0 ? "Delete" : "Deactivate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={params.page}
            totalPages={query.data.totalPages}
            total={query.data.total}
            pageSize={params.pageSize}
            pageSizeOptions={PAGE_SIZES}
            onPageChange={(page) => updateParams({ page: page > 1 ? page : undefined })}
            onPageSizeChange={(pageSize) => updateParams({ pageSize: pageSize === 20 ? undefined : pageSize })}
            busy={query.isPlaceholderData}
            itemLabel="suppliers"
          />
        </div>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming?.action === "delete"
            ? "Delete supplier?"
            : confirming?.action === "deactivate"
              ? "Deactivate supplier?"
              : "Reactivate supplier?"
        }
        confirmLabel={confirming?.action === "delete" ? "Delete" : confirming?.action === "deactivate" ? "Deactivate" : "Reactivate"}
        pendingLabel="Saving…"
        tone={confirming?.action === "reactivate" ? "default" : "danger"}
        pending={action.isPending}
        error={formErrorMessage(action.error)}
        onConfirm={() => confirming && action.mutate(confirming)}
        onClose={() => setConfirming(null)}
      >
        {confirming?.action === "delete" ? (
          <p>
            <strong>{confirming.supplier.name}</strong> has never been ordered from, so it can be removed completely.
          </p>
        ) : confirming?.action === "deactivate" ? (
          <p>
            <strong>{confirming.supplier.name}</strong> won't be offered for new purchase orders. Its existing orders and history stay,
            and open orders can still be received.
          </p>
        ) : (
          <p>
            <strong>{confirming?.supplier.name}</strong> will be available for new purchase orders again.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
