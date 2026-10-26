import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Alert } from "../components/Alert";
import { ErrorState } from "../components/ErrorState";
import { Field } from "../components/Field";
import { PageHeader } from "../components/PageHeader";
import { PurchasingSkeleton as PageLoader } from "../components/purchasing/PurchasingSkeleton";
import { Spinner } from "../components/Spinner";
import { ProductPicker } from "../components/purchasing/ProductPicker";
import { usePageTitle } from "../hooks/usePageTitle";
import { formatMoney } from "../lib/format";
import { fromCents, multiplyCents, toCents } from "../lib/money";
import { queryKeys } from "../lib/queryKeys";
import { focusFirstInvalid, formErrorMessage } from "../lib/validation";
import { paths, purchaseOrderPath } from "../routes/paths";
import { ApiError, toApiError } from "../services/apiError";
import { storeService } from "../services/inventoryService";
import { purchaseOrderService, supplierService } from "../services/purchasingService";
import type { Store } from "../types/inventory";
import type { PurchaseOrderDetail, PurchaseOrderInput, Supplier } from "../types/purchasing";

const MAX_QUANTITY = 1_000_000;

interface LineDraft {
  key: string;
  productId: string;
  sku: string;
  productName: string;
  quantity: string;
  unitCost: string;
}

type LineErrors = Partial<Record<"productId" | "quantity" | "unitCost", string>>;
type HeaderField = "supplierId" | "storeId" | "expectedAt" | "note" | "lines";

interface FormErrors {
  header: Partial<Record<HeaderField, string>>;
  lines: Record<number, LineErrors>;
}

const noErrors = (): FormErrors => ({ header: {}, lines: {} });
const hasAny = (errors: FormErrors) =>
  Object.values(errors.header).some(Boolean) || Object.values(errors.lines).some((line) => Object.values(line).some(Boolean));

interface OrderValues {
  supplierId: string;
  storeId: string;
  expectedAt: string;
  note: string;
  lines: LineDraft[];
}

/** Client-side checks, mirroring the API (which re-checks everything). */
function checkOrder(values: OrderValues): { ok: true; input: PurchaseOrderInput } | { ok: false; errors: FormErrors } {
  const errors = noErrors();
  if (!values.supplierId) errors.header.supplierId = "Choose a supplier";
  if (!values.storeId) errors.header.storeId = "Choose the store receiving the goods";
  if (values.note.length > 1000) errors.header.note = "Note must be at most 1,000 characters";
  values.lines.forEach((line, index) => {
    const lineErrors: LineErrors = {};
    const quantity = Number(line.quantity);
    if (!/^\d+$/.test(line.quantity.trim()) || quantity < 1) lineErrors.quantity = "Enter a whole number, 1 or more";
    else if (quantity > MAX_QUANTITY) lineErrors.quantity = "Quantity is too large";
    if (toCents(line.unitCost) === null) lineErrors.unitCost = "Use an amount like 4.99";
    if (Object.keys(lineErrors).length > 0) errors.lines[index] = lineErrors;
  });
  if (hasAny(errors)) return { ok: false, errors };
  return {
    ok: true,
    input: {
      supplierId: values.supplierId,
      storeId: values.storeId,
      expectedAt: values.expectedAt || null,
      note: values.note.trim() || null,
      lines: values.lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity), unitCost: line.unitCost.trim() })),
    },
  };
}

export default function PurchaseOrderEditorPage() {
  const { id } = useParams();
  usePageTitle(id ? "Edit purchase order" : "New purchase order");

  const orderQuery = useQuery({
    queryKey: queryKeys.purchaseOrders.detail(id ?? ""),
    queryFn: ({ signal }) => purchaseOrderService.get(id!, signal),
    enabled: Boolean(id),
  });
  const suppliersQuery = useQuery({
    queryKey: queryKeys.suppliers.options,
    queryFn: ({ signal }) => supplierService.options("active", signal),
    staleTime: 60_000,
  });
  const storesQuery = useQuery({
    queryKey: queryKeys.stores(),
    queryFn: ({ signal }) => storeService.list({}, signal),
    staleTime: 5 * 60_000,
  });

  const queries = [suppliersQuery, storesQuery, ...(id ? [orderQuery] : [])];
  const failed = queries.find((query) => query.isError);
  if (failed) {
    const error = toApiError(failed.error);
    return (
      <ErrorState
        title={error.status === 404 ? "Purchase order not found" : "Couldn't load the order form"}
        message={error.message}
        onRetry={error.status === 404 ? undefined : () => queries.forEach((query) => void query.refetch())}
        actions={
          <Link className="button button--ghost" to={paths.purchases}>
            Back to purchases
          </Link>
        }
      />
    );
  }
  if (queries.some((query) => query.isPending)) return <PageLoader message="Loading…" />;

  const order = id ? orderQuery.data! : null;
  if (order && order.status !== "DRAFT") {
    return (
      <ErrorState
        title={`${order.number} can't be edited`}
        message="Only draft orders can be changed. Once an order is placed, it changes only through deliveries or cancellation."
        actions={
          <Link className="button" to={purchaseOrderPath(order.id)}>
            View order
          </Link>
        }
      />
    );
  }
  return <OrderForm key={order?.id ?? "new"} order={order} suppliers={suppliersQuery.data!} stores={storesQuery.data!} />;
}

function OrderForm({ order, suppliers, stores }: { order: PurchaseOrderDetail | null; suppliers: Supplier[]; stores: Store[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);
  // A draft may belong to a supplier that has since been deactivated: keep it selectable.
  const supplierOptions = useMemo(() => {
    if (!order || suppliers.some((s) => s.id === order.supplier.id)) return suppliers;
    return [{ id: order.supplier.id, name: `${order.supplier.name} (inactive)` }, ...suppliers];
  }, [order, suppliers]);

  const preselected = searchParams.get("supplier");
  const [supplierId, setSupplierId] = useState(
    order?.supplier.id ?? (suppliers.some((s) => s.id === preselected) ? preselected! : ""),
  );
  const [storeId, setStoreId] = useState(order?.store.id ?? (stores.length === 1 ? stores[0].id : ""));
  const [expectedAt, setExpectedAt] = useState(order?.expectedAt ?? "");
  const [note, setNote] = useState(order?.note ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    (order?.lines ?? []).map((line) => ({
      key: crypto.randomUUID(),
      productId: line.productId,
      sku: line.sku,
      productName: line.productName,
      quantity: String(line.quantityOrdered),
      unitCost: line.unitCost,
    })),
  );
  const values: OrderValues = { supplierId, storeId, expectedAt, note, lines };

  // Before the first submit, no errors. After it, client checks run on every render, so
  // messages clear as the user fixes things. Errors from a submit (server rejections, or
  // "add a product first") are kept until any value changes.
  const [submitted, setSubmitted] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<{ errors: FormErrors; values: OrderValues } | null>(null);
  const submitErrorsCurrent =
    submitErrors !== null && (Object.keys(values) as (keyof OrderValues)[]).every((key) => values[key] === submitErrors.values[key]);
  const checked = checkOrder(values);
  const errors = submitErrorsCurrent ? submitErrors.errors : submitted && !checked.ok ? checked.errors : noErrors();

  // ── Saving ──

  const save = useMutation({
    mutationFn: async ({ input, place }: { input: PurchaseOrderInput; place: boolean; values: OrderValues }) => {
      const saved = order ? await purchaseOrderService.update(order.id, input) : await purchaseOrderService.create(input);
      return place ? purchaseOrderService.place(saved.id) : saved;
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      queryClient.setQueryData(queryKeys.purchaseOrders.detail(saved.id), saved);
      navigate(purchaseOrderPath(saved.id), {
        state: { notice: saved.status === "ORDERED" ? `${saved.number} was placed.` : `${saved.number} was saved as a draft.` },
      });
    },
    onError: (error, { values: sent }) => {
      setSubmitErrors({ errors: errorsFromApi(error), values: sent });
      focusFirstInvalid(formRef.current);
    },
  });

  function submit(place: boolean) {
    setSubmitted(true);
    setSubmitErrors(null);
    if (!checked.ok) {
      focusFirstInvalid(formRef.current);
      return;
    }
    if (place && checked.input.lines.length === 0) {
      setSubmitErrors({ errors: { header: { lines: "Add at least one product before placing the order" }, lines: {} }, values });
      return;
    }
    save.mutate({ input: checked.input, place, values });
  }

  // ── Totals (exact, in cents) ──

  const lineTotals = lines.map((line) => {
    const cents = toCents(line.unitCost);
    const quantity = Number(line.quantity);
    return cents !== null && Number.isInteger(quantity) && quantity > 0 ? multiplyCents(cents, quantity) : null;
  });
  const total = lineTotals.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n);
  const units = lines.reduce((sum, line) => sum + (Number.isInteger(Number(line.quantity)) ? Number(line.quantity) : 0), 0);

  const pending = save.isPending;
  const selectedIds = new Set(lines.map((line) => line.productId));
  const formError = submitErrorsCurrent && save.error ? (hasAny(errors) ? "Please correct the highlighted fields." : formErrorMessage(save.error)) : null;
  const updateLine = (index: number, changes: Partial<LineDraft>) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...changes } : line)));
  };
  const supplier = suppliers.find((s) => s.id === supplierId);

  return (
    <section>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={paths.purchases}>Purchases</Link>
        {order && (
          <>
            {" / "}
            <Link to={purchaseOrderPath(order.id)}>{order.number}</Link>
          </>
        )}
      </nav>
      <PageHeader
        title={order ? `Edit ${order.number}` : "New purchase order"}
        description="Drafts can be changed freely. Placing the order fixes its lines; stock is added only when goods are received."
      />

      <form
        ref={formRef}
        noValidate
        aria-busy={pending}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          submit(false);
        }}
      >
        {formError && <Alert tone="error">{formError}</Alert>}

        <div className="card card--spaced">
          <div className="form-grid form-grid--3">
            <Field label="Supplier" error={errors.header.supplierId} hint={supplier?.paymentTerms ? `Terms: ${supplier.paymentTerms}` : undefined}>
              {(control) => (
                <select
                  {...control}
                  value={supplierId}
                  onChange={(event) => setSupplierId(event.target.value)}
                  disabled={pending}
                >
                  <option value="">Choose a supplier…</option>
                  {supplierOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Deliver to" error={errors.header.storeId}>
              {(control) => (
                <select
                  {...control}
                  value={storeId}
                  onChange={(event) => setStoreId(event.target.value)}
                  disabled={pending}
                >
                  <option value="">Choose a store…</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Expected delivery (optional)" error={errors.header.expectedAt}>
              {(control) => (
                <input {...control} type="date" value={expectedAt} onChange={(event) => setExpectedAt(event.target.value)} disabled={pending} />
              )}
            </Field>
          </div>
          {suppliers.length === 0 && (
            <p className="form__hint">
              No active suppliers yet. <Link to={paths.suppliers}>Add a supplier</Link> first.
            </p>
          )}
        </div>

        <h2 className="section-title">Products</h2>
        <div className="order-lines card card--spaced">
          <ProductPicker
            selectedIds={selectedIds}
            disabled={pending || lines.length >= 200}
            onPick={(product) => {
              setLines((current) => [
                ...current,
                {
                  key: crypto.randomUUID(),
                  productId: product.id,
                  sku: product.sku,
                  productName: product.name,
                  quantity: "1",
                  unitCost: product.costPrice ?? "",
                },
              ]);
            }}
          />
          {errors.header.lines && <p className="form__error">{errors.header.lines}</p>}

          {lines.length === 0 ? (
            <p className="empty-hint">Search above to add the products you're ordering. Unit cost starts at each product's cost price.</p>
          ) : (
            <div className="table-wrap table-wrap--flat">
              <table className="data-table data-table--responsive line-table">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col" className="align-end">
                      Quantity
                    </th>
                    <th scope="col" className="align-end">
                      Unit cost
                    </th>
                    <th scope="col" className="align-end">
                      Line total
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const lineErrors = errors.lines[index] ?? {};
                    const lineTotal = lineTotals[index];
                    return (
                      <tr key={line.key}>
                        <td data-label="Product" className="data-table__primary">
                          <div className="cell-primary">{line.productName}</div>
                          <div className="cell-secondary mono">{line.sku}</div>
                          {lineErrors.productId && <p className="form__error">{lineErrors.productId}</p>}
                        </td>
                        <td data-label="Quantity" className="align-end">
                          <input
                            className="line-input"
                            inputMode="numeric"
                            aria-label={`Quantity of ${line.productName}`}
                            aria-invalid={lineErrors.quantity ? true : undefined}
                            value={line.quantity}
                            onChange={(event) => updateLine(index, { quantity: event.target.value })}
                            disabled={pending}
                          />
                          {lineErrors.quantity && <p className="form__error">{lineErrors.quantity}</p>}
                        </td>
                        <td data-label="Unit cost" className="align-end">
                          <input
                            className="line-input"
                            inputMode="decimal"
                            aria-label={`Unit cost of ${line.productName}`}
                            aria-invalid={lineErrors.unitCost ? true : undefined}
                            value={line.unitCost}
                            placeholder="0.00"
                            onChange={(event) => updateLine(index, { unitCost: event.target.value })}
                            disabled={pending}
                          />
                          {lineErrors.unitCost && <p className="form__error">{lineErrors.unitCost}</p>}
                        </td>
                        <td data-label="Line total" className="align-end nowrap cell-primary">
                          {lineTotal === null ? "—" : formatMoney(fromCents(lineTotal))}
                        </td>
                        <td className="data-table__actions align-end">
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                            disabled={pending}
                            aria-label={`Remove ${line.productName}`}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <dl className="order-totals">
            <div>
              <dt>Lines</dt>
              <dd>{lines.length}</dd>
            </div>
            <div>
              <dt>Units</dt>
              <dd>{units.toLocaleString()}</dd>
            </div>
            <div className="order-totals__grand">
              <dt>Order total</dt>
              <dd>{formatMoney(fromCents(total))}</dd>
            </div>
          </dl>
        </div>

        <div className="card card--spaced">
          <Field label="Note (optional)" error={errors.header.note} hint="Delivery instructions or a reference for the supplier.">
            {(control) => <textarea {...control} rows={2} value={note} onChange={(event) => setNote(event.target.value)} disabled={pending} />}
          </Field>
        </div>

        <div className="form-actions-bar">
          <Link className="button button--ghost" to={order ? purchaseOrderPath(order.id) : paths.purchases}>
            Cancel
          </Link>
          <button type="submit" className="button button--ghost" disabled={pending}>
            {pending && !save.variables?.place && <Spinner size={14} label="Saving" />}
            Save draft
          </button>
          <button type="button" className="button" onClick={() => submit(true)} disabled={pending}>
            {pending && save.variables?.place && <Spinner size={14} label="Placing order" />}
            Save &amp; mark as ordered
          </button>
        </div>
      </form>
    </section>
  );
}

/** Maps the API's issue paths (["supplierId"], ["lines", 2, "quantity"]) onto the form. */
function errorsFromApi(error: unknown): FormErrors {
  const result = noErrors();
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return result;
  for (const issue of error.details as { path?: unknown[]; message?: string }[]) {
    const [first, index, field] = issue.path ?? [];
    if (!issue.message) continue;
    if (first === "lines" && typeof index === "number" && typeof field === "string") {
      result.lines[index] = { ...result.lines[index], [field]: issue.message };
    } else if (typeof first === "string") {
      result.header[first as HeaderField] ??= issue.message;
    }
  }
  return result;
}
