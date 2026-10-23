import { Router } from "express";
import { verifyOrigin } from "../middleware/csrf.js";
import { createAuthRouter } from "./auth.routes.js";
import { createCategoriesRouter, createProductsRouter } from "./catalog.routes.js";
import { healthRouter } from "./health.routes.js";
import { createInventoryRouter, createStoresRouter } from "./inventory.routes.js";
import { createAuditLogsRouter, createPurchaseOrdersRouter, createSuppliersRouter } from "./purchasing.routes.js";
import { createUsersRouter } from "./users.routes.js";

export function createApiRouter() {
  const router = Router();

  router.use(verifyOrigin);

  router.use("/health", healthRouter);
  router.use("/auth", createAuthRouter());
  router.use("/users", createUsersRouter());
  router.use("/categories", createCategoriesRouter());
  router.use("/products", createProductsRouter());
  router.use("/stores", createStoresRouter());
  router.use("/inventory", createInventoryRouter());
  router.use("/suppliers", createSuppliersRouter());
  router.use("/purchase-orders", createPurchaseOrdersRouter());
  router.use("/audit-logs", createAuditLogsRouter());

  return router;
}
