import { useMutation } from "@tanstack/react-query";
import { useAuth, useCurrentUser } from "../auth/authContext";
import { roleLabels } from "../auth/permissions";
import { Alert } from "../components/Alert";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import { PageHeader } from "../components/PageHeader";
import { usePageTitle } from "../hooks/usePageTitle";
import { formatDateTime } from "../lib/format";
import { toApiError } from "../services/apiError";

export default function AccountPage() {
  usePageTitle("Your account");
  const user = useCurrentUser();
  const { logoutAll } = useAuth();
  const logoutAllMutation = useMutation({ mutationFn: logoutAll });

  return (
    <section>
      <PageHeader title="Your account" description="Your profile and sign-in security." />

      <div className="card-stack">
        <div className="card">
          <h2 className="card__title">Profile</h2>
          <dl className="details">
            <dt>Name</dt>
            <dd>{user.name}</dd>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Role</dt>
            <dd>
              <span className={`role-badge role-badge--${user.role.toLowerCase()}`}>{roleLabels[user.role]}</span>
            </dd>
            <dt>Last sign-in</dt>
            <dd>{formatDateTime(user.lastLoginAt)}</dd>
          </dl>
          {user.role !== "OWNER" && (
            <p className="card__note">To change your name, email or role, ask the store owner.</p>
          )}
        </div>

        <div className="card">
          <h2 className="card__title">Change password</h2>
          <p className="card__note">Changing your password signs you out on every other device.</p>
          <ChangePasswordForm />
        </div>

        <div className="card">
          <h2 className="card__title">Sessions</h2>
          <p className="card__note">
            Signed in on a shared or lost device? Sign out everywhere, including this browser.
          </p>
          {logoutAllMutation.isError && <Alert tone="error">{toApiError(logoutAllMutation.error).message}</Alert>}
          <button
            type="button"
            className="button button--ghost"
            onClick={() => logoutAllMutation.mutate()}
            disabled={logoutAllMutation.isPending}
          >
            {logoutAllMutation.isPending ? "Signing out…" : "Sign out of all devices"}
          </button>
        </div>
      </div>
    </section>
  );
}
