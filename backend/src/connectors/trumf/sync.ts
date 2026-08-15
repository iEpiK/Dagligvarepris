import { prisma } from "../../db";
import { decrypt, encrypt } from "../../utils/crypto";
import { TrumfConnector } from "./client";
import { NormalizedReceipt } from "../types";

const connector = new TrumfConnector();

/** Trumf sier i UI-et at eksporten er klar "innen 1 time" - bare diagnostikk, styrer ikke logikken. */
const EXPORT_WAIT_MS = 60 * 60 * 1000;

/**
 * Synker kvitteringer for én ChainConnection. Trumf sin eneste kilde til
 * per-vare-data (varelinjer) er en GDPR-databehandler-eksport som er
 * ASYNKRON (se client.ts) - denne funksjonen er derfor to-faset og
 * idempotent:
 *
 *  - Fase 1 (exportRequestedAt er tom): bestill en fersk eksport hos Trumf
 *    og lagre tidspunktet. Returnerer med det samme - INGEN kvitteringer
 *    hentes i denne runden.
 *  - Fase 2 (exportRequestedAt er satt): prøv å hente den ferdige
 *    eksporten. Ikke klar ennå -> ikke en feil, prøv igjen neste runde.
 *    Klar -> lagre receipts/items/products/prices og nullstill
 *    exportRequestedAt (neste synk-runde bestiller da en ny eksport).
 *
 * Siden SYNC_CRON som standard kjører hver 6. time, absorberes ventetiden
 * på ~1 time naturlig av neste planlagte runde uten egen poll-mekanisme.
 * Idempotent på lagring - Receipt er unik per (connectionId, externalId).
 */
export async function syncTrumfConnection(connectionId: string): Promise<void> {
  const connection = await prisma.chainConnection.findUniqueOrThrow({ where: { id: connectionId } });

  if (!connection.encryptedRefreshToken) {
    throw new Error("Tilkoblingen mangler refresh-token - må kobles til på nytt");
  }

  try {
    const storedRefreshToken = decrypt(connection.encryptedRefreshToken);
    const fresh = await connector.refreshAccessToken(storedRefreshToken);
    const freshRefreshToken = fresh.refreshToken ?? storedRefreshToken;

    if (!connection.exportRequestedAt) {
      // Fase 1: bestill en ny eksport.
      await connector.requestExport(fresh.accessToken);
      console.error(`[trumf] sync ${connectionId}: bestilte ny eksport hos Trumf, klar om inntil 1 time`);

      await prisma.chainConnection.update({
        where: { id: connectionId },
        data: {
          encryptedAccessToken: encrypt(fresh.accessToken),
          encryptedRefreshToken: encrypt(freshRefreshToken),
          accessTokenExpiresAt: fresh.expiresAt,
          exportRequestedAt: new Date(),
          status: "waiting_for_export",
          lastError: null,
        },
      });
      scheduleQuickExportChecks(connectionId);
      return;
    }

    // Fase 2: se om eksporten vi ba om tidligere er klar.
    const receipts = await connector.fetchExportIfReady(fresh.accessToken);

    if (!receipts) {
      const waitedMs = Date.now() - connection.exportRequestedAt.getTime();
      console.error(
        `[trumf] sync ${connectionId}: eksporten er ikke klar ennå (ventet ${Math.round(waitedMs / 60000)} min${
          waitedMs > EXPORT_WAIT_MS ? ", uvanlig lenge" : ""
        })`
      );
      await prisma.chainConnection.update({
        where: { id: connectionId },
        data: {
          encryptedAccessToken: encrypt(fresh.accessToken),
          encryptedRefreshToken: encrypt(freshRefreshToken),
          accessTokenExpiresAt: fresh.expiresAt,
        },
      });
      return;
    }

    console.error(`[trumf] sync ${connectionId}: hentet ${receipts.length} kvitteringer fra eksporten`);
    for (const receipt of receipts) {
      await saveReceipt(connectionId, receipt);
    }

    await prisma.chainConnection.update({
      where: { id: connectionId },
      data: {
        encryptedAccessToken: encrypt(fresh.accessToken),
        encryptedRefreshToken: encrypt(freshRefreshToken),
        accessTokenExpiresAt: fresh.expiresAt,
        lastSyncedAt: new Date(),
        exportRequestedAt: null,
        status: "active",
        lastError: null,
      },
    });
  } catch (err) {
    await prisma.chainConnection.update({
      where: { id: connectionId },
      data: { status: "error", lastError: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

/**
 * Trumf sier eksporten er klar "innen 1 time", men ofte raskere i praksis.
 * I stedet for å vente til neste faste SYNC_CRON-runde (opptil 6 timer, se
 * scheduler.ts) etter at en eksport nettopp er bestilt, planlegger vi to
 * raske sjekk-forsøk: etter 1 minutt og etter 10 minutter. Begge kaller
 * syncTrumfConnection på nytt, som - siden exportRequestedAt nå er satt -
 * UTELUKKENDE gjør fase 2 (GET-sjekk om eksporten er klar), ALDRI en ny
 * bestilling. Deretter faller vi tilbake på den faste 6-timers-runden.
 *
 * Kun i minnet (samme mønster som pendingLogins.ts) - overlever ikke en
 * restart av backend-prosessen i vinduet mellom bestilling og sjekk, men
 * det er uproblematisk siden den faste 6-timers-runden uansett plukker opp
 * tilkoblingen til slutt.
 */
function scheduleQuickExportChecks(connectionId: string): void {
  for (const delayMs of [1 * 60 * 1000, 10 * 60 * 1000]) {
    setTimeout(() => {
      syncTrumfConnection(connectionId).catch((err) => {
        console.error(
          `[trumf] rask eksport-sjekk feilet for ${connectionId}:`,
          err instanceof Error ? err.message : err
        );
      });
    }, delayMs);
  }
}

async function saveReceipt(connectionId: string, receipt: NormalizedReceipt): Promise<void> {
  const existing = await prisma.receipt.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: receipt.externalId } },
  });
  if (existing) return; // allerede lagret, kvitteringer endres ikke i ettertid

  let storeId: string | undefined;
  if (receipt.storeName) {
    const store = await prisma.store.upsert({
      where: {
        chain_externalId: {
          chain: receipt.storeChain ?? "ukjent",
          externalId: receipt.storeExternalId ?? receipt.storeName,
        },
      },
      update: {},
      create: {
        chain: receipt.storeChain ?? "ukjent",
        externalId: receipt.storeExternalId ?? receipt.storeName,
        name: receipt.storeName,
      },
    });
    storeId = store.id;
  }

  const createdReceipt = await prisma.receipt.create({
    data: {
      connectionId,
      externalId: receipt.externalId,
      storeId,
      purchasedAt: receipt.purchasedAt,
      totalAmount: receipt.totalAmount,
      rawPayload: receipt.rawPayload as any,
    },
  });

  for (const item of receipt.items) {
    const productId = await resolveProduct(item.rawName, item.ean);

    await prisma.receiptItem.create({
      data: {
        receiptId: createdReceipt.id,
        productId,
        rawName: item.rawName,
        ean: item.ean,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      },
    });

    if (productId) {
      await prisma.price.create({
        data: {
          productId,
          storeId,
          chain: receipt.storeChain ?? "ukjent",
          price: item.unitPrice,
          observedAt: receipt.purchasedAt,
          source: "receipt",
        },
      });
    }
  }
}

/**
 * Matcher på EAN når vi har det (pålitelig på tvers av kjeder). Uten EAN
 * oppretter vi et produkt basert på normalisert navn - grov matching som bør
 * forbedres med fuzzy-matching i fase 2 (se README).
 */
async function resolveProduct(rawName: string, ean?: string): Promise<string | undefined> {
  const normalizedName = normalizeProductName(rawName);
  if (!normalizedName) return undefined;

  if (ean) {
    const product = await prisma.product.upsert({
      where: { ean },
      update: {},
      create: { ean, name: rawName, normalizedName },
    });
    return product.id;
  }

  const existing = await prisma.product.findFirst({ where: { normalizedName, ean: null } });
  if (existing) return existing.id;

  const created = await prisma.product.create({ data: { name: rawName, normalizedName } });
  return created.id;
}

function normalizeProductName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
