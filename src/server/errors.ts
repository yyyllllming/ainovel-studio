import { ZodError } from "zod";

export interface AppErrorOptions {
  status: number;
  code: string;
  details?: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, options: AppErrorOptions) {
    super(message);
    this.name = "AppError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function notFound(message: string, details?: unknown) {
  return new AppError(message, { status: 404, code: "NOT_FOUND", details });
}

export function badRequest(message: string, details?: unknown) {
  return new AppError(message, { status: 400, code: "BAD_REQUEST", details });
}

export function conflict(message: string, details?: unknown) {
  return new AppError(message, { status: 409, code: "CONFLICT", details });
}

export function forbidden(message: string, details?: unknown) {
  return new AppError(message, { status: 403, code: "FORBIDDEN", details });
}
export function unauthorized(message: string, details?: unknown) {
  return new AppError(message, { status: 401, code: "UNAUTHORIZED", details });
}

export function internalError(message: string, details?: unknown) {
  return new AppError(message, { status: 500, code: "INTERNAL_ERROR", details });
}

export interface HttpErrorShape {
  message: string;
  status: number;
  code?: string;
  details?: unknown;
}

export function describeErrorForHttp(
  error: unknown,
  fallbackMessage: string,
  fallbackStatus = 500,
): HttpErrorShape {
  if (isAppError(error)) {
    return { message: error.message, status: error.status, code: error.code, details: error.details };
  }
  if (error instanceof ZodError) {
    return {
      message: error.issues.map((issue) => issue.message).join("; "),
      status: 400,
      code: "VALIDATION_ERROR",
      details: error.issues,
    };
  }
  return {
    message: error instanceof Error ? error.message : fallbackMessage,
    status: fallbackStatus,
  };
}
