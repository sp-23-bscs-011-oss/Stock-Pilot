import { createContext, useContext } from "react";
import type { ChangePasswordInput, LoginInput, SessionResponse, SetupOwnerInput, User } from "../types/auth";

export type AuthStatus = "loading" | "authenticated" | "anonymous" | "error";

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** The last check failed for a reason other than "not signed in" (e.g. API offline). */
  error: Error | null;
  /** True when a session ended underneath the user (expired, revoked, deactivated). */
  sessionEnded: boolean;
  login: (input: LoginInput) => Promise<SessionResponse>;
  setupOwner: (input: SetupOwnerInput) => Promise<SessionResponse>;
  changePassword: (input: ChangePasswordInput) => Promise<SessionResponse>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refresh: () => Promise<unknown>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}

/** For components rendered behind <RequireAuth>, where a user is guaranteed. */
export function useCurrentUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("useCurrentUser must be used behind <RequireAuth>");
  return user;
}
