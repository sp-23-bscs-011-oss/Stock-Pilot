export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, "BAD_REQUEST", message, details);
  }

  static unauthorized(message = "Authentication required", code = "UNAUTHENTICATED") {
    return new AppError(401, code, message);
  }

  static forbidden(message = "You do not have permission to perform this action", code = "FORBIDDEN") {
    return new AppError(403, code, message);
  }

  static notFound(message = "Resource not found") {
    return new AppError(404, "NOT_FOUND", message);
  }

  static conflict(message: string, code = "CONFLICT") {
    return new AppError(409, code, message);
  }

  static tooManyRequests(message: string, code = "TOO_MANY_REQUESTS") {
    return new AppError(429, code, message);
  }

  static serviceUnavailable(message = "Service unavailable") {
    return new AppError(503, "SERVICE_UNAVAILABLE", message);
  }
}
