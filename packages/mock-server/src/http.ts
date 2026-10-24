// The spec's error shape (docs/16-rest-api.md §16.2) for everything the mock
// answers — including Express's own fallbacks, which would otherwise be HTML.

import type { NextFunction, Request, Response } from "express";
import type { ApiError } from "@ofl-panel/shared";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly extra: Omit<ApiError, "error"> = {},
  ) {
    super(error);
  }
}

export const badRequest = () => new HttpError(400, "bad_request");
export const notFound = () => new HttpError(404, "not_found");
export const notWritable = () => new HttpError(405, "not_writable");
export const noFreeSlots = () => new HttpError(409, "no_free_slots");
export const missingCapabilities = (missing: string[]) => new HttpError(422, "missing_capabilities", { missing });

export function sendError(res: Response, status: number, error: string, extra: Omit<ApiError, "error"> = {}) {
  res.status(status).json({ error, ...extra } satisfies ApiError);
}

/** §16.1: request bodies are JSON — a PUT/POST with anything else is malformed. */
export function requireJson(req: Request, res: Response, next: NextFunction) {
  if ((req.method === "POST" || req.method === "PUT") && !req.is("application/json")) {
    return sendError(res, 400, "bad_request");
  }
  next();
}

export function notFoundFallback(_req: Request, res: Response) {
  sendError(res, 404, "not_found");
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return sendError(res, err.status, err.error, err.extra);
  if ((err as { type?: string })?.type === "entity.parse.failed") return sendError(res, 400, "bad_request");
  console.error("[http] unhandled error:", err);
  sendError(res, 500, "internal_error");
}
