interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** Disables controls while the next page loads. */
  busy?: boolean;
  itemLabel?: string;
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  pageSizeOptions = [10, 20, 50, 100],
  onPageChange,
  onPageSizeChange,
  busy = false,
  itemLabel = "items",
}: PaginationProps) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav className="pagination" aria-label="Pagination">
      <p className="pagination__summary" aria-live="polite">
        {total === 0 ? `No ${itemLabel}` : `${first}–${last} of ${total} ${itemLabel}`}
      </p>
      <div className="pagination__controls">
        <label className="pagination__size">
          <span>Rows</span>
          <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} disabled={busy}>
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button button--ghost button--sm"
          onClick={() => onPageChange(page - 1)}
          disabled={busy || page <= 1}
        >
          Previous
        </button>
        <span className="pagination__page">
          Page {Math.min(page, totalPages)} of {totalPages}
        </span>
        <button
          type="button"
          className="button button--ghost button--sm"
          onClick={() => onPageChange(page + 1)}
          disabled={busy || page >= totalPages}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
