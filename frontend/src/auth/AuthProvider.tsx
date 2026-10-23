import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { queryKeys } from "../lib/queryKeys";
import { setAuthErrorListener } from "../services/apiClient";
import { authService } from "../services/authService";
import type { SessionResponse } from "../types/auth";
import { AuthContext, type AuthContextValue } from "./authContext";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [sessionEnded, setSessionEnded] = useState(false);

  const meQuery = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: ({ signal }) => authService.me(signal),
    staleTime: 5 * 60_000,
    // Notice expired or revoked sessions when someone returns to the tab.
    refetchOnWindowFocus: true,
  });

  /** Replaces the signed-in session and drops every cached query that belonged to the previous one. */
  const applySession = useCallback(
    (session: SessionResponse | null) => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
      queryClient.setQueryData(queryKeys.auth.me, session);
    },
    [queryClient],
  );

  useEffect(() => {
    setAuthErrorListener((error) => {
      if (error.code === "PASSWORD_CHANGE_REQUIRED") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
        return;
      }
      // A 401 while signed in means the server ended the session.
      if (queryClient.getQueryData(queryKeys.auth.me)) {
        setSessionEnded(true);
        applySession(null);
      }
    });
    return () => setAuthErrorListener(null);
  }, [queryClient, applySession]);

  const value = useMemo<AuthContextValue>(() => {
    const startSession = (session: SessionResponse) => {
      setSessionEnded(false);
      applySession(session);
      return session;
    };

    const user = meQuery.data?.user ?? null;
    let status: AuthContextValue["status"] = "anonymous";
    if (meQuery.isPending) status = "loading";
    else if (user) status = "authenticated";
    else if (meQuery.isError) status = "error";

    return {
      status,
      user,
      error: meQuery.error,
      sessionEnded,
      login: async (input) => startSession(await authService.login(input)),
      setupOwner: async (input) => {
        const session = startSession(await authService.setupOwner(input));
        void queryClient.invalidateQueries({ queryKey: queryKeys.auth.setupStatus });
        return session;
      },
      // Keeps the user signed in (the server issues a new session), but other devices are signed out.
      changePassword: async (input) => {
        const session = await authService.changePassword(input);
        queryClient.setQueryData(queryKeys.auth.me, session);
        return session;
      },
      logout: async () => {
        await authService.logout();
        applySession(null);
      },
      logoutAll: async () => {
        await authService.logoutAll();
        applySession(null);
      },
      refresh: () => meQuery.refetch(),
    };
  }, [meQuery, sessionEnded, applySession, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
