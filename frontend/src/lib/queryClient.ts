import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../services/apiError";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Client errors won't succeed on retry; network and server errors might.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status !== null && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
