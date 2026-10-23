import { Link, Navigate, Outlet, useLocation, type Location } from "react-router";
import { ErrorState } from "../components/ErrorState";
import { PageLoader } from "../components/PageLoader";
import { usePageTitle } from "../hooks/usePageTitle";
import { paths } from "../routes/paths";
import { toApiError } from "../services/apiError";
import type { Role } from "../types/auth";
import { useAuth, useCurrentUser } from "./authContext";

export interface RedirectState {
  from?: Location;
}

function FullPageLoader() {
  return (
    <div className="route-error">
      <PageLoader message="Checking your session…" />
    </div>
  );
}

/**
 * Gate for signed-in areas. Sends anonymous visitors to the login page (remembering where
 * they were going) and users holding a temporary password to the change-password page.
 */
export function RequireAuth() {
  const { status, user, error, refresh } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FullPageLoader />;

  if (status === "error") {
    return (
      <div className="route-error">
        <ErrorState
          title="Can't verify your session"
          message={toApiError(error).message}
          onRetry={() => void refresh()}
        />
      </div>
    );
  }

  if (!user) {
    return <Navigate to={paths.login} replace state={{ from: location } satisfies RedirectState} />;
  }

  const onChangePasswordPage = location.pathname === paths.changePassword;
  if (user.mustChangePassword && !onChangePasswordPage) {
    return <Navigate to={paths.changePassword} replace state={{ from: location } satisfies RedirectState} />;
  }
  if (!user.mustChangePassword && onChangePasswordPage) {
    // Either the change just succeeded, or the page was opened directly; carry on either way.
    return <Navigate to={redirectTarget(location)} replace />;
  }

  return <Outlet />;
}

/** Keeps signed-in users off the login and setup pages. */
export function GuestOnly() {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FullPageLoader />;
  if (user) return <Navigate to={redirectTarget(location)} replace />;
  return <Outlet />;
}

function redirectTarget(location: Location): string {
  const from = (location.state as RedirectState | null)?.from;
  return from ? `${from.pathname}${from.search}` : paths.dashboard;
}

export function RequireRole({ roles }: { roles: Role[] }) {
  const user = useCurrentUser();
  return roles.includes(user.role) ? <Outlet /> : <AccessDenied />;
}

function AccessDenied() {
  usePageTitle("Access denied");
  return (
    <ErrorState
      title="You don't have access to this page"
      message="Your role doesn't include this area of StockPilot. Ask the owner if you need access."
      actions={
        <Link to={paths.dashboard} className="button">
          Go to dashboard
        </Link>
      }
    />
  );
}
