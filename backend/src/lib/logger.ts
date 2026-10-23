import { pino } from "pino";
import { env } from "../config/env.js";

const usePrettyOutput = env.NODE_ENV === "development";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "stockpilot-api" },
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
    censor: "[REDACTED]",
  },
  // Human-readable output in development; structured JSON everywhere else.
  ...(usePrettyOutput
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname,service" },
        },
      }
    : {}),
});
