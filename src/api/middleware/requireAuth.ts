import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors.js";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.userId) {
    next(new ApiError(401, "UNAUTHENTICATED", "You must be logged in"));
    return;
  }
  next();
}
