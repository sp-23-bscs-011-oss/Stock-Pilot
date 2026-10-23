import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { isProduction } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

interface HttpError {
  status: number;
  expose?: boolean;
  message: string;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  let statusCode = 500;
  let body: ErrorBody = {
    error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" },
  };

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err instanceof ZodError) {
    statusCode = 400;
    body = { error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: err.issues } };
  } else if (isClientHttpError(err)) {
    // Errors raised by Express/body-parser, e.g. malformed JSON or payload too large.
    statusCode = err.status;
    body = { error: { code: "BAD_REQUEST", message: err.expose ? err.message : "Malformed request" } };
  }

  if (statusCode >= 500) {
    req.log.error({ err }, "Unhandled error");
    if (!isProduction && err instanceof Error) {
      body.error.message = err.message;
    }
  }

  body.error.requestId = String(req.id);
  res.status(statusCode).json(body);
};

function isClientHttpError(err: unknown): err is HttpError {
  if (typeof err !== "object" || err === null || !("status" in err)) return false;
  const { status } = err as { status: unknown };
  return typeof status === "number" && status >= 400 && status < 500;
}
