import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import type { ReactNode } from "react";
import { AuthProvider } from "../auth/AuthProvider";
import { env } from "../config/env";
import { queryClient } from "../lib/queryClient";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
      {env.isDev && <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />}
    </QueryClientProvider>
  );
}
