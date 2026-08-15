import { prisma } from "../../db";
import { decrypt } from "../../utils/crypto";
import { TrumfConnector } from "./client";
import { NormalizedReceipt } from "../types";

const connector = new TrumfConnector();

/**
 * Synker kvitteringer for én ChainConnection: henter fra Trumf, normaliserer,
 * og lagrer receipts/items/products/prices. Idempotent - kjøres trygt på
 * gjentakelse siden Receipt er unik per (connectionId, externalId).
 */
export async function syncTrumfConnection(connectionId: string): Promise<void> {
  const connection = await prisma.chainConnection.findUniqueOrThrow({ where: { id: connectionId } });

  if (!connection.encryptedAccessToken) {
    throw new Error("Tilkoblingen mangler access token");
  }

  const accessToken = decrypt(connection.encryptedAccessToken);

  // Første sync henter siste 12 måneder, senere sync henter fra forrige synk.
  const fromDate = connection.lastSyncedAt ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const toDate = new Date();

  try {
    const receipts = await connector.fetchReceipts({ accessToken }, fromDate, toDate);

    for (const receipt of receipts) {
      await saveReceipt(connectionId, receipt);
    }

    await prisma.chainConnection.update({
      where: { id: connectionId },
      data: { lastSyncedAt: toDate, status: "active", lastError: null },
    });
  } catch (err) {
    await prisma.chainConnection.update({
      where: { id: connectionId },
      data: { status: "error", lastError: err instanceof Error ? err.message : String(err) },
    });
    throw err;
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
