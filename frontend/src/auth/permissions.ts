import { paths } from "../routes/paths";
import type { Role } from "../types/auth";

const ALL: Role[] = ["OWNER", "MANAGER", "CASHIER"];
const MANAGEMENT: Role[] = ["OWNER", "MANAGER"];

/**
 * Which roles may open each page. This drives navigation and route guards for a better
 * experience only — the API enforces the same rules on every request.
 */
export const routeAccess: Record<string, Role[]> = {
  [paths.dashboard]: ALL,
  [paths.products]: ALL,
  // Everyone can check stock; adjustments and history are limited to management inside the page.
  [paths.inventory]: ALL,
  [paths.suppliers]: MANAGEMENT,
  [paths.purchases]: MANAGEMENT,
  [paths.pos]: ALL,
  [paths.sales]: ALL,
  [paths.reports]: MANAGEMENT,
  [paths.staff]: ["OWNER"],
  [paths.settings]: ["OWNER"],
  [paths.account]: ALL,
};

export function canAccess(role: Role, path: string): boolean {
  return (routeAccess[path] ?? ALL).includes(role);
}

/** Creating, editing and archiving products and categories. Mirrors the API's rule. */
export function canManageCatalog(role: Role): boolean {
  return role === "OWNER" || role === "MANAGER";
}

export const roleLabels: Record<Role, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  CASHIER: "Cashier",
};
