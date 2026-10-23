import { Link } from "react-router";
import { ErrorState } from "../components/ErrorState";
import { usePageTitle } from "../hooks/usePageTitle";
import { paths } from "../routes/paths";

export default function NotFoundPage() {
  usePageTitle("Page not found");

  return (
    <ErrorState
      title="Page not found"
      message="The page you requested doesn't exist or has moved."
      actions={
        <Link to={paths.dashboard} className="button">
          Go to dashboard
        </Link>
      }
    />
  );
}
