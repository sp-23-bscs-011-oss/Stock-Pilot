import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useCurrentUser } from "../auth/authContext";
import { roleLabels } from "../auth/permissions";
import { Alert } from "../components/Alert";
import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import { Spinner } from "../components/Spinner";
import { TextField } from "../components/TextField";
import { usePageTitle } from "../hooks/usePageTitle";
import { formatDateTime } from "../lib/format";
import { queryKeys } from "../lib/queryKeys";
import {
  PASSWORD_HINT,
  fieldErrorsFromApi,
  focusFirstInvalid,
  formErrorMessage,
  generateTemporaryPassword,
  hasErrors,
  validateEmail,
  validateName,
  validateNewPassword,
  type FieldErrors,
} from "../lib/validation";
import { ApiError, toApiError } from "../services/apiError";
import { userService } from "../services/userService";
import type { StaffRole, User } from "../types/auth";

const STAFF_ROLES: StaffRole[] = ["MANAGER", "CASHIER"];

export default function StaffPage() {
  usePageTitle("Staff");
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<{ user: User; password: string } | null>(null);
  const usersQuery = useQuery({ queryKey: queryKeys.users, queryFn: ({ signal }) => userService.list(signal) });

  return (
    <section>
      <PageHeader
        title="Staff"
        description="Create accounts for managers and cashiers, change their roles, and switch access off when someone leaves."
        actions={
          !adding && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setCreated(null);
                setAdding(true);
              }}
            >
              Add staff member
            </button>
          )
        }
      />

      {created && (
        <Alert tone="success">
          <strong>{created.user.name}</strong> can now sign in as {created.user.email} with the temporary password{" "}
          <code className="secret">{created.password}</code>. Share it privately — they'll be asked to replace it at
          first sign-in.
        </Alert>
      )}

      {adding && (
        <CreateStaffForm
          onCancel={() => setAdding(false)}
          onCreated={(user, password) => {
            setAdding(false);
            setCreated({ user, password });
          }}
        />
      )}

      <QueryState query={usersQuery} loadingMessage="Loading staff…" errorTitle="Couldn't load staff">
        {(users) => <StaffTable users={users} />}
      </QueryState>
    </section>
  );
}

type CreateField = "name" | "email" | "role" | "password";
type CreateValues = { name: string; email: string; role: StaffRole; password: string };

function validateCreate(values: CreateValues): FieldErrors<CreateField> {
  return {
    name: validateName(values.name),
    email: validateEmail(values.email),
    password: validateNewPassword(values.password),
  };
}

function CreateStaffForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (user: User, password: string) => void }) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<CreateValues>(() => ({
    name: "",
    email: "",
    role: "CASHIER",
    password: generateTemporaryPassword(),
  }));
  const [errors, setErrors] = useState<FieldErrors<CreateField>>({});
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: userService.create,
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
      onCreated(user, values.password);
    },
    onError: (error) => {
      const fieldErrors = fieldErrorsFromApi(error);
      if (error instanceof ApiError && error.code === "EMAIL_TAKEN") fieldErrors.email = "A user with this email already exists";
      setErrors(fieldErrors);
      focusFirstInvalid(formRef.current);
    },
  });

  function update<K extends CreateField>(field: K, value: CreateValues[K]) {
    const next = { ...values, [field]: value };
    setValues(next);
    if (submitted) setErrors(validateCreate(next));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    const nextErrors = validateCreate(values);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) {
      focusFirstInvalid(formRef.current);
      return;
    }
    mutation.mutate({ ...values, name: values.name.trim(), email: values.email.trim() });
  }

  const pending = mutation.isPending;
  // A taken email is shown on the email field, so it doesn't need a banner too.
  const emailTaken = mutation.error instanceof ApiError && mutation.error.code === "EMAIL_TAKEN";
  const formError = emailTaken ? null : formErrorMessage(mutation.error);

  return (
    <div className="card card--spaced">
      <h2 className="card__title">New staff member</h2>
      <form ref={formRef} className="form" onSubmit={handleSubmit} noValidate aria-busy={pending}>
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="form-grid">
          <TextField
            label="Full name"
            autoComplete="off"
            autoFocus
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
            error={errors.name}
            disabled={pending}
          />
          <TextField
            label="Email"
            type="email"
            autoComplete="off"
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
            error={errors.email}
            disabled={pending}
          />
          <div className="form__field">
            <label htmlFor="new-staff-role">Role</label>
            <select
              id="new-staff-role"
              value={values.role}
              onChange={(event) => update("role", event.target.value as StaffRole)}
              disabled={pending}
            >
              {STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </select>
            <p className="form__hint">
              {values.role === "MANAGER"
                ? "Managers run stock, suppliers, purchases and reports."
                : "Cashiers use the point of sale and look up products."}
            </p>
          </div>
          <div className="form__field-with-action">
            <TextField
              label="Temporary password"
              autoComplete="off"
              spellCheck={false}
              value={values.password}
              onChange={(event) => update("password", event.target.value)}
              error={errors.password}
              hint={PASSWORD_HINT}
              disabled={pending}
            />
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => update("password", generateTemporaryPassword())}
              disabled={pending}
            >
              Generate
            </button>
          </div>
        </div>
        <div className="form__actions">
          <button type="submit" className="button" disabled={pending}>
            {pending && <Spinner size={14} label="Creating" />}
            {pending ? "Creating…" : "Create account"}
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function StaffTable({ users }: { users: User[] }) {
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const onDone = (text: string) => {
    setNotice({ tone: "success", text });
    void queryClient.invalidateQueries({ queryKey: queryKeys.users });
  };
  const onFail = (error: unknown) => setNotice({ tone: "error", text: toApiError(error).message });

  const updateRole = useMutation({
    mutationFn: ({ user, role }: { user: User; role: StaffRole }) => userService.update(user.id, { role }),
    onSuccess: (user) => onDone(`${user.name} is now a ${roleLabels[user.role].toLowerCase()}.`),
    onError: onFail,
  });
  const setActive = useMutation({
    mutationFn: ({ user, active }: { user: User; active: boolean }) => userService.setActive(user.id, active),
    onSuccess: (user) =>
      onDone(user.isActive ? `${user.name} can sign in again.` : `${user.name} has been deactivated and signed out.`),
    onError: onFail,
  });

  const busyId = (updateRole.isPending && updateRole.variables?.user.id) || (setActive.isPending && setActive.variables?.user.id);

  return (
    <>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <StaffList
        users={users}
        renderRole={(user) =>
          user.role === "OWNER" ? undefined : (
            <select
              aria-label={`Role for ${user.name}`}
              value={user.role}
              disabled={busyId === user.id || !user.isActive}
              onChange={(event) => updateRole.mutate({ user, role: event.target.value as StaffRole })}
            >
              {STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </select>
          )
        }
        renderActions={(user) =>
          user.id === currentUser.id || user.role === "OWNER" ? null : (
            <div className="table-actions">
              <button
                type="button"
                className={user.isActive ? "button button--ghost button--sm button--danger" : "button button--ghost button--sm"}
                disabled={busyId === user.id}
                onClick={() => setActive.mutate({ user, active: !user.isActive })}
              >
                {user.isActive ? "Deactivate" : "Activate"}
              </button>
              <button
                type="button"
                className="button button--ghost button--sm"
                disabled={busyId === user.id || resettingId === user.id}
                onClick={() => setResettingId(user.id)}
              >
                Reset password
              </button>
            </div>
          )
        }
        renderExpanded={(user) =>
          resettingId === user.id ? (
            <ResetPasswordForm
              user={user}
              onClose={() => setResettingId(null)}
              onReset={(password) => {
                setResettingId(null);
                onDone(`${user.name}'s temporary password is ${password}. They've been signed out and must change it at next sign-in.`);
              }}
            />
          ) : null
        }
      />
      {users.every((user) => user.role === "OWNER") && (
        <p className="empty-hint">No staff yet. Add your managers and cashiers so each has their own sign-in.</p>
      )}
    </>
  );
}

interface StaffListProps {
  users: User[];
  renderRole?: (user: User) => ReactNode;
  renderActions?: (user: User) => ReactNode;
  renderExpanded?: (user: User) => ReactNode;
}

function StaffList({ users, renderRole, renderActions, renderExpanded }: StaffListProps) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">Last sign-in</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const expanded = renderExpanded?.(user);
            return (
              <StaffRow key={user.id} user={user} expanded={expanded}>
                <td>{renderRole?.(user) ?? <RoleBadge user={user} />}</td>
                <td>
                  <span className={`status-badge ${user.isActive ? "status-badge--ok" : "status-badge--pending"}`}>
                    <span className="status-badge__dot" aria-hidden="true" />
                    {user.isActive ? (user.mustChangePassword ? "Invited" : "Active") : "Deactivated"}
                  </span>
                </td>
                <td className="nowrap">{formatDateTime(user.lastLoginAt)}</td>
                <td className="align-end">{renderActions?.(user)}</td>
              </StaffRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StaffRow({ user, expanded, children }: { user: User; expanded: ReactNode; children: ReactNode }) {
  return (
    <>
      <tr className={user.isActive ? undefined : "is-muted"}>
        <td>
          <div className="cell-primary">{user.name}</div>
          <div className="cell-secondary">{user.email}</div>
        </td>
        {children}
      </tr>
      {expanded && (
        <tr className="data-table__expanded">
          <td colSpan={5}>{expanded}</td>
        </tr>
      )}
    </>
  );
}

function RoleBadge({ user }: { user: User }) {
  return <span className={`role-badge role-badge--${user.role.toLowerCase()}`}>{roleLabels[user.role]}</span>;
}

function ResetPasswordForm({ user, onClose, onReset }: { user: User; onClose: () => void; onReset: (password: string) => void }) {
  const [password, setPassword] = useState(generateTemporaryPassword);
  const [error, setError] = useState<string | undefined>();
  const mutation = useMutation({
    mutationFn: () => userService.resetPassword(user.id, password),
    onSuccess: () => onReset(password),
    onError: (err) => setError(fieldErrorsFromApi(err).password ?? toApiError(err).message),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateNewPassword(password);
    setError(problem);
    if (!problem) mutation.mutate();
  }

  return (
    <form className="inline-form" onSubmit={handleSubmit} noValidate aria-busy={mutation.isPending}>
      <TextField
        label={`New temporary password for ${user.name}`}
        autoComplete="off"
        spellCheck={false}
        autoFocus
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={error}
        disabled={mutation.isPending}
      />
      <div className="form__actions">
        <button type="submit" className="button button--sm" disabled={mutation.isPending}>
          {mutation.isPending ? "Resetting…" : "Reset and sign out"}
        </button>
        <button type="button" className="button button--ghost button--sm" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </button>
      </div>
    </form>
  );
}
