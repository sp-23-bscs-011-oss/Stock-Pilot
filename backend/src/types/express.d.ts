import type { Session, User } from "../generated/prisma/client.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth` for authenticated requests. */
      auth?: { user: User; session: Session };
    }
  }
}

export {};
