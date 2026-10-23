import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { queryKeys } from "../../lib/queryKeys";
import { fieldErrorsFromApi, type FieldErrors } from "../../lib/validation";
import { toApiError } from "../../services/apiError";
import { storeService } from "../../services/inventoryService";
import type { Store } from "../../types/inventory";
import { Alert } from "../Alert";
import { QueryState } from "../QueryState";
import { Spinner } from "../Spinner";
import { TextField } from "../TextField";

type StoreField = "name" | "code";

function validateStore(values: Record<StoreField, string>): FieldErrors<StoreField> {
  const name = values.name.trim();
  return {
    name: name.length < 2 ? "Enter a name of at least 2 characters" : name.length > 80 ? "Name is too long" : undefined,
    code: /^[A-Za-z0-9][A-Za-z0-9-]{1,15}$/.test(values.code.trim()) ? undefined : "Use 2–16 letters, numbers or dashes",
  };
}

/** Owner-only: the locations that hold stock. Stores are deactivated, never deleted. */
export function StoresSection() {
  const queryClient = useQueryClient();
  const storesQuery = useQuery({
    queryKey: queryKeys.stores(true),
    queryFn: ({ signal }) => storeService.list({ includeInactive: true }, signal),
  });

  const [values, setValues] = useState({ name: "", code: "" });
  const [errors, setErrors] = useState<FieldErrors<StoreField>>({});
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.storesAll });

  const create = useMutation({
    mutationFn: () => storeService.create({ name: values.name.trim(), code: values.code.trim() }),
    onSuccess: (store) => {
      setValues({ name: "", code: "" });
      setErrors({});
      setNotice({ tone: "success", text: `${store.name} (${store.code}) was added.` });
      refresh();
    },
    onError: (error) => setErrors(fieldErrorsFromApi(error)),
  });

  const toggle = useMutation({
    mutationFn: (store: Store) => storeService.update(store.id, { isActive: !store.isActive }),
    onSuccess: (store) => {
      setNotice({ tone: "success", text: `${store.name} is now ${store.isActive ? "active" : "inactive"}.` });
      refresh();
    },
    onError: (error) => setNotice({ tone: "error", text: toApiError(error).message }),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateStore(values);
    setErrors(nextErrors);
    if (!nextErrors.name && !nextErrors.code) create.mutate();
  }

  return (
    <div className="card">
      <h2 className="card__title">Stores</h2>
      <p className="card__note">
        Each store keeps its own stock. Deactivated stores keep their history but can't receive adjustments.
      </p>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <QueryState query={storesQuery} loadingMessage="Loading stores…" errorTitle="Couldn't load stores">
        {(stores) => (
          <ul className="category-list">
            {stores.map((store) => (
              <li key={store.id} className="category-list__item">
                <div className="category-list__row">
                  <div>
                    <div className="cell-primary">
                      {store.name} <span className="cell-secondary mono">{store.code}</span>
                    </div>
                    <div className="cell-secondary">{store.isActive ? "Active" : "Inactive"}</div>
                  </div>
                  <button
                    type="button"
                    className={`button button--ghost button--sm${store.isActive ? " button--danger" : ""}`}
                    onClick={() => toggle.mutate(store)}
                    disabled={toggle.isPending && toggle.variables?.id === store.id}
                  >
                    {store.isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryState>

      <form className="form store-form" onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <TextField
            label="New store name"
            placeholder="e.g. Downtown"
            autoComplete="off"
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
            error={errors.name}
            disabled={create.isPending}
          />
          <TextField
            label="Code"
            placeholder="e.g. DT"
            autoComplete="off"
            spellCheck={false}
            className="input--mono"
            value={values.code}
            onChange={(event) => setValues({ ...values, code: event.target.value })}
            error={errors.code}
            disabled={create.isPending}
          />
        </div>
        <div>
          <button type="submit" className="button" disabled={create.isPending}>
            {create.isPending && <Spinner size={14} label="Adding" />}
            Add store
          </button>
        </div>
      </form>
    </div>
  );
}
