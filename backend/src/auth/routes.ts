import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { signSessionToken } from "../utils/jwt";

export const authRouter = Router();

authRouter.post("/signup", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "E-post og passord (minst 8 tegn) er påkrevd" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "En bruker med denne e-posten finnes allerede" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { email, passwordHash } });

  const token = signSessionToken({ userId: user.id });
  res.status(201).json({ token });
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "E-post og passord er påkrevd" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Feil e-post eller passord" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Feil e-post eller passord" });
  }

  const token = signSessionToken({ userId: user.id });
  res.json({ token });
});
