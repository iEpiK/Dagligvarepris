import { Router } from "express";
import { prisma } from "../db";

export const productsRouter = Router();

/** Søk i produktkatalogen. Offentlig - dette er selve verdien av tjenesten. */
productsRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  if (!q) {
    return res.json({ products: [] });
  }

  const products = await prisma.product.findMany({
    where: { normalizedName: { contains: q } },
    take: 25,
    orderBy: { name: "asc" },
  });

  res.json({ products });
});

/** Nåværende laveste/siste pris per kjede for et produkt. */
productsRouter.get("/:id", async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) return res.status(404).json({ error: "Fant ikke produktet" });

  const latestPrices = await prisma.price.findMany({
    where: { productId: product.id },
    orderBy: { observedAt: "desc" },
    take: 200,
    include: { store: true },
  });

  // Siste observerte pris per kjede.
  const latestByChain = new Map<string, (typeof latestPrices)[number]>();
  for (const p of latestPrices) {
    if (!latestByChain.has(p.chain)) latestByChain.set(p.chain, p);
  }

  res.json({ product, latestByChain: Array.from(latestByChain.values()) });
});

/** Prishistorikk for graf, gruppert per kjede. */
productsRouter.get("/:id/prices", async (req, res) => {
  const days = Number(req.query.days) || 365;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const prices = await prisma.price.findMany({
    where: { productId: req.params.id, observedAt: { gte: since } },
    orderBy: { observedAt: "asc" },
    include: { store: true },
  });

  res.json({
    series: prices.map((p: (typeof prices)[number]) => ({
      chain: p.chain,
      storeName: p.store?.name ?? null,
      price: Number(p.price),
      observedAt: p.observedAt,
    })),
  });
});
