import { hashPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";
import { isUniqueViolation } from "../lib/prismaErrors.js";
import { AppError } from "../utils/AppError.js";
import { revokeUserSessions } from "./session.service.js";
import type { Role, User } from "../generated/prisma/client.js";

type StaffRole = Exclude<Role, "OWNER">;

/** The only user shape that ever leaves the API — never includes the password hash. */
export function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export type PublicUser = ReturnType<typeof toPublicUser>;

export async function listUsers(filter: { status: "active" | "inactive" | "all"; role?: Role }) {
  const users = await prisma.user.findMany({
    where: {
      role: filter.role,
      isActive: filter.status === "all" ? undefined : filter.status === "active",
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return users.map(toPublicUser);
}

async function findUserOrThrow(id: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw AppError.notFound("User not found");
  return user;
}

/** Loads a staff account for modification; the owner account can't be changed through staff management. */
async function findStaffOrThrow(id: string): Promise<User> {
  const user = await findUserOrThrow(id);
  if (user.role === "OWNER") {
    throw AppError.forbidden("The owner account cannot be modified through staff management", "OWNER_IMMUTABLE");
  }
  return user;
}

export async function getUser(id: string) {
  return toPublicUser(await findUserOrThrow(id));
}

export async function createStaff(
  input: { name: string; email: string; role: StaffRole; password: string },
  createdById: string,
) {
  try {
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        role: input.role,
        passwordHash: await hashPassword(input.password),
        mustChangePassword: true,
        createdById,
      },
    });
    return toPublicUser(user);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError.conflict("A user with this email already exists", "EMAIL_TAKEN");
    }
    throw error;
  }
}

export async function updateStaff(id: string, input: { name?: string; role?: StaffRole }) {
  await findStaffOrThrow(id);
  // Roles are read from the database on every request, so a role change applies immediately.
  const user = await prisma.user.update({ where: { id }, data: { name: input.name, role: input.role } });
  return toPublicUser(user);
}

export async function setStaffActive(id: string, isActive: boolean) {
  await findStaffOrThrow(id);
  const user = await prisma.user.update({ where: { id }, data: { isActive } });
  if (!isActive) await revokeUserSessions(id, "ACCOUNT_DEACTIVATED");
  return toPublicUser(user);
}

export async function resetStaffPassword(id: string, password: string) {
  await findStaffOrThrow(id);
  const user = await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(password), mustChangePassword: true, passwordChangedAt: new Date() },
  });
  await revokeUserSessions(id, "PASSWORD_RESET");
  return toPublicUser(user);
}
