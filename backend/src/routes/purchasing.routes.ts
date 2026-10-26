import { Router } from "express";
import * as purchasing from "../controllers/purchasing.controller.js";
import { requireAuth, requirePasswordChanged, requireRole } from "../middleware/authenticate.js";
import { requireCsrf } from "../middleware/csrf.js";

// Purchasing exposes costs and supplier terms, so it is management-only throughout.
const management = [requireAuth, requireCsrf, requirePasswordChanged, requireRole("OWNER", "MANAGER")];

export function createSuppliersRouter() {
  const router = Router();
  router.use(...management);

  router.get("/", purchasing.listSuppliers);
  // Registered before "/:id" so "report" isn't read as an id.
  router.get("/report", purchasing.supplierReport);
  router.get("/:id", purchasing.getSupplier);
  router.post("/", purchasing.createSupplier);
  router.patch("/:id", purchasing.updateSupplier);
  router.patch("/:id/status", purchasing.updateSupplierStatus);
  router.delete("/:id", purchasing.deleteSupplier);

  return router;
}

export function createPurchaseOrdersRouter() {
  const router = Router();
  router.use(...management);

  router.get("/", purchasing.listPurchaseOrders);
  router.get("/:id", purchasing.getPurchaseOrder);
  router.post("/", purchasing.createPurchaseOrder);
  router.put("/:id", purchasing.updatePurchaseOrder);
  router.patch("/:id", purchasing.updatePurchaseOrder);
  router.post("/:id/submit", purchasing.placePurchaseOrder);
  router.post("/:id/order", purchasing.placePurchaseOrder);
  router.post("/:id/cancel", purchasing.cancelPurchaseOrder);
  router.post("/:id/receipts", purchasing.receivePurchaseOrder);
  router.get("/:id/receipts", purchasing.listPurchaseReceipts);
  router.post("/:id/payments", requireRole("OWNER"), purchasing.recordPurchasePayment);

  return router;
}

export function createAuditLogsRouter() {
  const router = Router();
  router.use(...management);
  router.get("/", purchasing.listAuditLogs);
  return router;
}
