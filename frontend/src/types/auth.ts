export type Role = "OWNER" | "MANAGER" | "CASHIER";
export type StaffRole = Exclude<Role, "OWNER">;

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Returned by login, setup, /me and change-password. */
export interface SessionResponse {
  user: User;
  csrfToken: string;
  session: { expiresAt: string };
}

export interface SetupStatus {
  setupRequired: boolean;
  setupEnabled: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface SetupOwnerInput {
  setupToken: string;
  name: string;
  email: string;
  password: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface CreateStaffInput {
  name: string;
  email: string;
  role: StaffRole;
  password: string;
}

export interface UpdateStaffInput {
  name?: string;
  role?: StaffRole;
}
