import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toApiError } from "../services/apiError";
import { ErrorState } from "./ErrorState";
import { PageLoader } from "./PageLoader";

interface QueryStateProps<T> {
  query: UseQueryResult<T>;
  loadingMessage?: string;
  errorTitle?: string;
  children: (data: T) => ReactNode;
}

/** Renders the loading, error and success branches of a query consistently across pages. */
export function QueryState<T>({ query, loadingMessage, errorTitle, children }: QueryStateProps<T>) {
  if (query.isPending) {
    return <PageLoader message={loadingMessage} />;
  }

  if (query.isError) {
    const error = toApiError(query.error);
    return (
      <ErrorState
        title={errorTitle}
        message={error.message}
        detail={error.requestId ? `Request ID: ${error.requestId}` : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  return <>{children(query.data)}</>;
}
