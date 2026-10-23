import type { CreateStaffInput, UpdateStaffInput, User } from "../types/auth";
import { api } from "./apiClient";

type UserResponse = { user: User };

export const userService = {
  async list(signal?: AbortSignal): Promise<User[]> {
    return (await api.get<{ users: User[] }>("/users", { signal })).users;
  },

  async create(input: CreateStaffInput): Promise<User> {
    return (await api.post<UserResponse>("/users", input)).user;
  },

  async update(id: string, input: UpdateStaffInput): Promise<User> {
    return (await api.patch<UserResponse>(`/users/${id}`, input)).user;
  },

  async setActive(id: string, active: boolean): Promise<User> {
    return (await api.post<UserResponse>(`/users/${id}/${active ? "activate" : "deactivate"}`)).user;
  },

  async resetPassword(id: string, password: string): Promise<User> {
    return (await api.post<UserResponse>(`/users/${id}/reset-password`, { password })).user;
  },
};
