import { Router } from "express";
import * as auth from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireCsrf } from "../middleware/csrf.js";
import { createLoginRateLimiters, createSetupRateLimiter } from "../middleware/rateLimit.js";

export function createAuthRouter() {
  const router = Router();

  // Public
  router.get("/setup", auth.getSetupStatus);
  router.post("/setup", createSetupRateLimiter(), auth.setupOwner);
  router.post("/login", ...createLoginRateLimiters(), auth.login);

  // Authenticated. Deliberately not gated by requirePasswordChanged, so a user with a
  // temporary password can still load their profile, change it, or sign out.
  router.get("/me", requireAuth, auth.me);
  router.post("/logout", requireAuth, requireCsrf, auth.logout);
  router.post("/logout-all", requireAuth, requireCsrf, auth.logoutAll);
  router.post("/change-password", requireAuth, requireCsrf, auth.changePassword);

  return router;
}
