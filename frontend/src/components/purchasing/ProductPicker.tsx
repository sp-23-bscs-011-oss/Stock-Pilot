import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { formatMoney } from "../../lib/format";
import { queryKeys } from "../../lib/queryKeys";
import { productService } from "../../services/catalogService";
import type { Product, ProductListParams } from "../../types/catalog";

interface ProductPickerProps {
  /** Products already on the order, shown as such instead of offered again. */
  selectedIds: Set<string>;
  onPick: (product: Product) => void;
  disabled?: boolean;
}

/** Type to search active products by name, SKU or barcode (a scanner works too), then pick one. */
export function ProductPicker({ selectedIds, onPick, disabled }: ProductPickerProps) {
  const listId = useId();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const params: ProductListParams = { page: 1, pageSize: 8, search, status: "active", sort: "name", order: "asc" };
  const query = useQuery({
    queryKey: queryKeys.products.list(params),
    queryFn: ({ signal }) => productService.list(params, signal),
    enabled: search.length > 0,
  });
  const results = search ? (query.data?.items ?? []) : [];

  function pick(product: Product) {
    onPick(product);
    setText("");
    setSearch("");
  }

  return (
    <div className="product-picker">
      <label className="visually-hidden" htmlFor={`${listId}-input`}>
        Add a product
      </label>
      <input
        id={`${listId}-input`}
        type="search"
        placeholder="Add a product: search name, SKU or scan a barcode…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // A scanner types the barcode and presses Enter: add the exact match straight away.
          if (event.key === "Enter") {
            event.preventDefault();
            const exact = results.find(
              (product) =>
                !selectedIds.has(product.id) &&
                (product.barcode === text.trim() || product.sku.toLowerCase() === text.trim().toLowerCase()),
            );
            const only = results.filter((product) => !selectedIds.has(product.id));
            if (exact) pick(exact);
            else if (only.length === 1) pick(only[0]);
          }
        }}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        aria-controls={listId}
        aria-expanded={results.length > 0}
      />
      {search && (
        <ul id={listId} className="product-picker__results" aria-live="polite">
          {query.isFetching && results.length === 0 ? (
            <li className="product-picker__empty">Searching…</li>
          ) : query.isError ? (
            <li className="product-picker__empty">Couldn't load products. <button type="button" className="button button--ghost button--sm" onClick={() => void query.refetch()}>Try again</button></li>
          ) : results.length === 0 ? (
            <li className="product-picker__empty">No active products match “{search}”.</li>
          ) : (
            results.map((product) => {
              const added = selectedIds.has(product.id);
              return (
                <li key={product.id}>
                  <button type="button" className="product-picker__option" onClick={() => pick(product)} disabled={added || disabled}>
                    <span>
                      <span className="cell-primary">{product.name}</span>
                      <span className="cell-secondary mono"> {product.sku}</span>
                    </span>
                    <span className="cell-secondary">{added ? "On the order" : `Cost ${formatMoney(product.costPrice)}`}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
