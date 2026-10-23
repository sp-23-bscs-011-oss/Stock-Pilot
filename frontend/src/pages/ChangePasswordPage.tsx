import { useAuth, useCurrentUser } from "../auth/authContext";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import { usePageTitle } from "../hooks/usePageTitle";

/** Shown to users holding a temporary password; every other page redirects here until it's changed. */
export default function ChangePasswordPage() {
  usePageTitle("Choose a new password");
  const user = useCurrentUser();
  const { logout } = useAuth();

  return (
    <div className="login">
      <h1 className="login__title">Choose a new password</h1>
      <p className="login__subtitle">
        Welcome, {user.name}. Your account was set up with a temporary password — replace it with one only you know.
      </p>
      <ChangePasswordForm currentPasswordLabel="Temporary password" submitLabel="Save and continue" />
      <p className="login__footnote">
        Not you?{" "}
        <button type="button" className="link-button" onClick={() => void logout()}>
          Sign out
        </button>
      </p>
    </div>
  );
}
