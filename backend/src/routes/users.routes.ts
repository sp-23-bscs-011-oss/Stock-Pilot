import { Router } from "express";
import * as users from "../controllers/users.controller.js";
import { requireAuth, requirePasswordChanged, requireRole } from "../middleware/authenticate.js";
import { requireCsrf } from "../middleware/csrf.js";

export function createUsersRouter() {
  const router = Router();

  // Staff management is owner-only.
  router.use(requireAuth, requireCsrf, requirePasswordChanged, requireRole("OWNER"));

  router.get("/", users.listUsers);
  router.post("/", users.createStaff);
  router.get("/:id", users.getUser);
  router.patch("/:id", users.updateStaff);
  router.post("/:id/activate", users.activateStaff);
  router.post("/:id/deactivate", users.deactivateStaff);
  router.post("/:id/reset-password", users.resetStaffPassword);

  return router;
}
