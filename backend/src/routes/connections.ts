import { Router } from "express";
import { prisma } from "../db";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { encrypt } from "../utils/crypto";
import { completeWebLoginWithOtp, startWebLogin, WebLoginTokens } from "../connectors/trumf/webAuth";
import { savePendingLogin, takePendingLogin } from "../connectors/trumf/pendingLogins";
import { syncTrumfConnection } from "../connectors/trumf/sync";

export const connectionsRouter = Router();
connectionsRouter.use(requireAuth);

/** Liste over egne tilkoblinger og status (koblet til / feil / sist synket). */
connectionsRouter.get("/", async (req: AuthedRequest, res) => {
  const connections = await prisma.chainConnection.findMany({
    where: { userId: req.userId },
    select: { id: true, chain: true, status: true, lastSyncedAt: true, lastError: true, createdAt: true },
  });
  res.json({ connections });
});

/**
 * Steg 1 av "koble til Trumf": telefonnummer + passord. Fullfører flyten
 * beskrevet i webAuth.ts. Normalt vil Trumf kreve en SMS-bekreftelse på en
 * fersk sesjon (ingen "husket enhet") - da returnerer vi et pendingLoginId
 * som brukes i /trumf/otp under. Skjer det (usannsynlig) ikke, kobler vi til
 * med det samme.
 */
connectionsRouter.post("/trumf/start", async (req: AuthedRequest, res) => {
  const { phoneNumber, password } = req.body ?? {};
  if (typeof phoneNumber !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Telefonnummer og passord er påkrevd" });
  }

  try {
    const result = await startWebLogin(phoneNumber, password);

    if (result.done) {
      await saveConnection(req.userId!, result.tokens);
      return res.status(201).json({ status: "connected" });
    }

    const pendingLoginId = savePendingLogin(req.userId!, result.pending);
    res.status(202).json({ status: "otp_required", pendingLoginId });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Kunne ikke logge inn hos Trumf" });
  }
});

/** Steg 2 av "koble til Trumf": SMS-engangskoden brukeren mottok. */
connectionsRouter.post("/trumf/otp", async (req: AuthedRequest, res) => {
  const { pendingLoginId, otp } = req.body ?? {};
  if (typeof pendingLoginId !== "string" || typeof otp !== "string") {
    return res.status(400).json({ error: "Mangler pendingLoginId eller SMS-kode" });
  }

  const pending = takePendingLogin(req.userId!, pendingLoginId);
  if (!pending) {
    return res.status(400).json({ error: "Innloggingsforsøket er utløpt eller ugyldig - start på nytt" });
  }

  try {
    const tokens = await completeWebLoginWithOtp(pending, otp);
    await saveConnection(req.userId!, tokens);
    res.status(201).json({ status: "connected" });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Feil SMS-kode" });
  }
});

async function saveConnection(userId: string, tokens: WebLoginTokens): Promise<void> {
  const connection = await prisma.chainConnection.upsert({
    where: { userId_chain: { userId, chain: "trumf" } },
    update: {
      encryptedAccessToken: encrypt(tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      accessTokenExpiresAt: tokens.expiresAt,
      status: "active",
      lastError: null,
    },
    create: {
      userId,
      chain: "trumf",
      encryptedAccessToken: encrypt(tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      accessTokenExpiresAt: tokens.expiresAt,
    },
  });

  // Trigge første synk med en gang, uten å blokkere svaret unødig lenge.
  syncTrumfConnection(connection.id).catch(() => {
    /* status/feil er allerede lagret av syncTrumfConnection selv */
  });
}

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
