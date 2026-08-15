import jwt from "jsonwebtoken";

export interface JwtPayload {
  userId: string;
}

export function signSessionToken(payload: JwtPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET mangler i miljøvariabler");
  return jwt.sign(payload, secret, { expiresIn: "30d" });
}

export function verifySessionToken(token: string): JwtPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET mangler i miljøvariabler");
  return jwt.verify(token, secret) as JwtPayload;
}
