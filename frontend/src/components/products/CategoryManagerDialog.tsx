import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { queryKeys } from "../../lib/queryKeys";
import { fieldErrorsFromApi } from "../../lib/validation";
import { toApiError } from "../../services/apiError";
import { categoryService } from "../../services/catalogService";
import type { Category } from "../../types/catalog";
import { Alert } from "../Alert";
import { Dialog } from "../Dialog";
import { Spinner } from "../Spinner";
import { TextField } from "../TextField";

interface CategoryManagerDialogProps {
  open: boolean;
  categories: Category[];
  onClose: () => void;
}

function validateName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a category name";
  if (trimmed.length > 60) return "Name must be at most 60 characters";
  return undefined;
}

export function CategoryManagerDialog({ open, categories, onClose }: CategoryManagerDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Categories"
      description="Group products for browsing, filtering and reports."
    >
      <CategoryManager categories={categories} />
      <footer className="dialog__footer">
        <button type="button" className="button button--ghost" onClick={onClose}>
          Done
        </button>
      </footer>
    </Dialog>
  );
}

function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
    // Product rows show their category name.
    void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
  };
}

function CategoryManager({ categories }: { categories: Category[] }) {
  const invalidate = useInvalidateCatalog();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();

  const create = useMutation({
    mutationFn: () => categoryService.create({ name: name.trim() }),
    onSuccess: () => {
      setName("");
      setError(undefined);
      invalidate();
    },
    onError: (err) => setError(fieldErrorsFromApi(err).name ?? toApiError(err).message),
  });

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateName(name);
    setError(problem);
    if (!problem) create.mutate();
  }

  return (
    <div className="dialog__content">
      <form className="category-add" onSubmit={handleCreate} noValidate>
        <TextField
          label="New category"
          placeholder="e.g. Beverages"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={error}
          disabled={create.isPending}
        />
        <button type="submit" className="button" disabled={create.isPending}>
          {create.isPending && <Spinner size={14} label="Adding" />}
          Add
        </button>
      </form>

      {categories.length === 0 ? (
        <p className="empty-hint">No categories yet. Products without one are listed as “Uncategorized”.</p>
      ) : (
        <ul className="category-list">
          {categories.map((category) => (
            <CategoryRow key={category.id} category={category} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const invalidate = useInvalidateCatalog();
  const [mode, setMode] = useState<"view" | "rename" | "confirm-delete">("view");
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | undefined>();

  const rename = useMutation({
    mutationFn: () => categoryService.update(category.id, { name: name.trim() }),
    onSuccess: () => {
      setMode("view");
      setError(undefined);
      invalidate();
    },
    onError: (err) => setError(fieldErrorsFromApi(err).name ?? toApiError(err).message),
  });

  const remove = useMutation({
    mutationFn: () => categoryService.remove(category.id),
    onSuccess: invalidate,
    onError: (err) => setError(toApiError(err).message),
  });

  const inUse = category.totalProductCount > 0;
  const archivedCount = category.totalProductCount - category.productCount;

  if (mode === "rename") {
    return (
      <li className="category-list__item">
        <form
          className="category-add"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const problem = validateName(name);
            setError(problem);
            if (!problem) rename.mutate();
          }}
        >
          <TextField
            label={`Rename “${category.name}”`}
            autoFocus
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={error}
            disabled={rename.isPending}
          />
          <div className="form__actions">
            <button type="submit" className="button button--sm" disabled={rename.isPending}>
              {rename.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => {
                setMode("view");
                setName(category.name);
                setError(undefined);
              }}
              disabled={rename.isPending}
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="category-list__item">
      <div className="category-list__row">
        <div>
          <div className="cell-primary">{category.name}</div>
          <div className="cell-secondary">
            {category.productCount} product{category.productCount === 1 ? "" : "s"}
            {archivedCount > 0 && ` · ${archivedCount} archived`}
          </div>
        </div>
        <div className="table-actions">
          {mode === "confirm-delete" ? (
            <>
              <button
                type="button"
                className="button button--sm button--danger-solid"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                {remove.isPending ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => setMode("view")}
                disabled={remove.isPending}
              >
                Keep
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button button--ghost button--sm" onClick={() => setMode("rename")}>
                Rename
              </button>
              <button
                type="button"
                className="button button--ghost button--sm button--danger"
                onClick={() => setMode("confirm-delete")}
                disabled={inUse}
                title={
                  category.productCount > 0
                    ? "Move its products to another category first"
                    : inUse
                      ? "Archived products still belong to this category, so it's kept for their history. Rename it instead."
                      : undefined
                }
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </li>
  );
}
