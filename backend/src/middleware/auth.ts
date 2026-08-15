import { NextFunction, Request, Response } from "express";
import { verifySessionToken } from "../utils/jwt";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Mangler autentisering" });
  }
  try {
    const token = header.slice("Bearer ".length);
    const payload = verifySessionToken(token);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Ugyldig eller utløpt sesjon" });
  }
}
