import { Router } from "express";
import * as inventory from "../controllers/inventory.controller.js";
import { requireAuth, requirePasswordChanged, requireRole } from "../middleware/authenticate.js";
import { requireCsrf } from "../middleware/csrf.js";

const signedIn = [requireAuth, requireCsrf, requirePasswordChanged];
const management = requireRole("OWNER", "MANAGER");

export function createInventoryRouter() {
  const router = Router();
  router.use(...signedIn);

  // Every role can see what's on hand (cashiers need to know what they can sell).
  router.get("/", inventory.listInventory);
  // Changing stock and reading the audit trail are management tasks.
  router.post("/adjustments", management, inventory.adjustStock);
  router.get("/movements", management, inventory.listMovements);

  return router;
}

export function createStoresRouter() {
  const router = Router();
  router.use(...signedIn);

  router.get("/", inventory.listStores);
  router.post("/", requireRole("OWNER"), inventory.createStore);
  router.patch("/:id", requireRole("OWNER"), inventory.updateStore);

  return router;
}
