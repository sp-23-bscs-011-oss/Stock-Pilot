import type { RequestHandler } from "express";
import { isProduction } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

const DB_CHECK_TIMEOUT_MS = 3000;

type DatabaseStatus = { status: "up"; latencyMs: number } | { status: "down"; error?: string };

async function checkDatabase(): Promise<DatabaseStatus> {
  const startedAt = performance.now();
  let timer: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${DB_CHECK_TIMEOUT_MS}ms`)), DB_CHECK_TIMEOUT_MS);
      }),
    ]);
    return { status: "up", latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return { status: "down", error: describeDatabaseError(error) };
  } finally {
    clearTimeout(timer);
  }
}

// Driver-adapter failures carry the useful signal (e.g. ECONNREFUSED, P1000) in `code`;
// their `message` is often just Prisma's invocation banner.
function describeDatabaseError(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.message.trim() || error.name : "Unknown database error";
}

export const getHealth: RequestHandler = async (req, res) => {
  const database = await checkDatabase();
  const healthy = database.status === "up";

  if (!healthy) {
    req.log.warn({ database }, "Health check failed: database unreachable");
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    services: {
      api: { status: "up" },
      // Connection errors can leak hostnames, so only expose the reason outside production.
      database: healthy || !isProduction ? database : { status: "down" },
    },
  });
};
