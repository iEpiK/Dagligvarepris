import { Router } from "express";
import { prisma } from "../db";

export const productsRouter = Router();

const PAGE_SIZE = 30;

/**
 * Søk og/eller bla i produktkatalogen. Offentlig - dette er selve verdien av
 * tjenesten. Uten "q" eller "category" gis ingen treff (unngår å dumpe hele
 * katalogen på forsiden) - bruk /products/categories + ?category=... for å
 * bla uten søk.
 */
productsRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
  const page = Math.max(1, Number(req.query.page) || 1);

  if (!q && !category) {
    return res.json({ products: [], hasMore: false });
  }

  const where: Record<string, unknown> = {};
  if (q) where.normalizedName = { contains: q };
  if (category) where.category = category;

  const products = await prisma.product.findMany({
    where,
    take: PAGE_SIZE + 1,
    skip: (page - 1) * PAGE_SIZE,
    orderBy: { name: "asc" },
  });

  const hasMore = products.length > PAGE_SIZE;
  res.json({ products: products.slice(0, PAGE_SIZE), hasMore });
});

/** Liste over kategorier med antall produkter i hver - grunnlaget for "bla uten å søke". */
productsRouter.get("/categories", async (_req, res) => {
  const grouped = await prisma.product.groupBy({
    by: ["category"],
    where: { category: { not: null } },
    _count: { _all: true },
    orderBy: { category: "asc" },
  });

  const categories = grouped
    .filter((g: (typeof grouped)[number]) => g.category)
    .map((g: (typeof grouped)[number]) => ({ category: g.category as string, count: g._count._all }))
    .sort((a: { count: number }, b: { count: number }) => b.count - a.count);

  res.json({ categories });
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
