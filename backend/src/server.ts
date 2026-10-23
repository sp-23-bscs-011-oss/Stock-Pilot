import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`StockPilot API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

server.on("error", (error) => {
  logger.fatal({ err: error }, "HTTP server failed to start");
  process.exit(1);
});

let shuttingDown = false;

function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully`);

  const forceExit = setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(() => {
    prisma
      .$disconnect()
      .catch((error: unknown) => logger.error({ err: error }, "Error disconnecting Prisma"))
      .finally(() => {
        logger.info("Shutdown complete");
        process.exit(exitCode);
      });
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  shutdown("uncaughtException", 1);
});
