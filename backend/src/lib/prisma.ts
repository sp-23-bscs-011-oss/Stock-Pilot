import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";
import { PrismaClient } from "../generated/prisma/client.js";

// A single client (and connection pool) is shared across the whole process.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({
  adapter,
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
