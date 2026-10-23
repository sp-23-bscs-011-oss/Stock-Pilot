import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { env } from "../config/env";
import { paths } from "../routes/paths";
import { ErrorState } from "./ErrorState";

export function RouteErrorPage() {
  const error = useRouteError();

  let title = "Unexpected application error";
  let message = "This page failed to load. Try again, or return to the dashboard.";
  let detail: string | undefined;

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    message = typeof error.data === "string" ? error.data : message;
  } else if (error instanceof Error) {
    // A failed dynamic import usually means a new deploy replaced the old chunks.
    if (/dynamically imported module|Importing a module script failed/i.test(error.message)) {
      message = "A newer version of StockPilot may be available. Reload the page to continue.";
    }
    if (env.isDev) detail = error.message;
  }

  return (
    <div className="route-error">
      <ErrorState
        title={title}
        message={message}
        detail={detail}
        onRetry={() => window.location.reload()}
        actions={
          <Link to={paths.dashboard} className="button button--ghost">
            Go to dashboard
          </Link>
        }
      />
    </div>
  );
}
