import { Router } from "express";
import { prisma } from "../db";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { encrypt } from "../utils/crypto";
import { TrumfConnector } from "../connectors/trumf/client";
import { syncTrumfConnection } from "../connectors/trumf/sync";

export const connectionsRouter = Router();
connectionsRouter.use(requireAuth);

const trumf = new TrumfConnector();

/** Liste over egne tilkoblinger og status (koblet til / feil / sist synket). */
connectionsRouter.get("/", async (req: AuthedRequest, res) => {
  const connections = await prisma.chainConnection.findMany({
    where: { userId: req.userId },
    select: { id: true, chain: true, status: true, lastSyncedAt: true, lastError: true, createdAt: true },
  });
  res.json({ connections });
});

/**
 * Koble til Trumf: bruker sender inn telefonnummer+passord én gang, vi
 * bytter det mot en token og lagrer den kryptert. Selve login() kaster
 * foreløpig en feil inntil det uoffisielle endepunktet er verifisert -
 * se README.
 */
connectionsRouter.post("/trumf", async (req: AuthedRequest, res) => {
  const { phoneNumber, password } = req.body ?? {};
  if (typeof phoneNumber !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Telefonnummer og passord er påkrevd" });
  }

  try {
    const auth = await trumf.login({ phoneNumber, password });

    const connection = await prisma.chainConnection.upsert({
      where: { userId_chain: { userId: req.userId!, chain: "trumf" } },
      update: {
        encryptedAccessToken: encrypt(auth.accessToken),
        encryptedRefreshToken: auth.refreshToken ? encrypt(auth.refreshToken) : null,
        accessTokenExpiresAt: auth.expiresAt,
        status: "active",
        lastError: null,
      },
      create: {
        userId: req.userId!,
        chain: "trumf",
        encryptedAccessToken: encrypt(auth.accessToken),
        encryptedRefreshToken: auth.refreshToken ? encrypt(auth.refreshToken) : null,
        accessTokenExpiresAt: auth.expiresAt,
      },
    });

    // Trigge første synk med en gang, uten å blokkere svaret unødig lenge.
    syncTrumfConnection(connection.id).catch(() => {
      /* status/feil er allerede lagret av syncTrumfConnection selv */
    });

    res.status(201).json({ connectionId: connection.id, status: "connecting" });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Kunne ikke koble til Trumf" });
  }
});

/** Trigge en manuell resynk (i tillegg til den periodiske bakgrunnsjobben). */
connectionsRouter.post("/:id/sync", async (req: AuthedRequest, res) => {
  const connection = await prisma.chainConnection.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!connection) return res.status(404).json({ error: "Fant ikke tilkoblingen" });

  try {
    await syncTrumfConnection(connection.id);
    res.json({ status: "ok" });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Synk feilet" });
  }
});

/** Koble fra og slette all lagret data for tilkoblingen (personvern). */
connectionsRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const connection = await prisma.chainConnection.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!connection) return res.status(404).json({ error: "Fant ikke tilkoblingen" });

  await prisma.chainConnection.delete({ where: { id: connection.id } }); // cascade sletter receipts/items
  res.json({ status: "deleted" });
});
