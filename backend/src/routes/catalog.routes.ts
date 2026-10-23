import { Router } from "express";
import * as categories from "../controllers/categories.controller.js";
import * as products from "../controllers/products.controller.js";
import { requireAuth, requirePasswordChanged, requireRole } from "../middleware/authenticate.js";
import { requireCsrf } from "../middleware/csrf.js";

const signedIn = [requireAuth, requireCsrf, requirePasswordChanged];
// Every role can browse the catalog (cashiers need it at the till); only management changes it.
const manageCatalog = requireRole("OWNER", "MANAGER");

export function createProductsRouter() {
  const router = Router();
  router.use(...signedIn);

  router.get("/", products.listProducts);
  router.get("/:id", products.getProduct);
  router.post("/", manageCatalog, products.createProduct);
  router.patch("/:id", manageCatalog, products.updateProduct);
  router.post("/:id/archive", manageCatalog, products.archiveProduct);
  router.post("/:id/restore", manageCatalog, products.restoreProduct);
  // Deliberately no DELETE: products are archived so historical invoices keep resolving.

  return router;
}

export function createCategoriesRouter() {
  const router = Router();
  router.use(...signedIn);

  router.get("/", categories.listCategories);
  router.post("/", manageCatalog, categories.createCategory);
  router.patch("/:id", manageCatalog, categories.updateCategory);
  router.delete("/:id", manageCatalog, categories.deleteCategory);

  return router;
}
