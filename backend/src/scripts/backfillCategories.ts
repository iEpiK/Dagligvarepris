/**
 * Engangs-script: setter kategori på produkter som allerede finnes i
 * databasen fra før kategorisering (se utils/categorize.ts) ble innført.
 * Nye produkter får kategori satt automatisk fremover (se sync.ts).
 *
 * Kjøres slik etter deploy:
 *   docker compose exec backend npm run categorize:backfill
 */
import { prisma } from "../db";
import { categorizeProduct } from "../utils/categorize";

async function main() {
  const products = await prisma.product.findMany({ where: { category: null } });
  console.log(`Fant ${products.length} produkter uten kategori.`);

  let updated = 0;
  for (const product of products) {
    const category = categorizeProduct(product.normalizedName);
    await prisma.product.update({ where: { id: product.id }, data: { category } });
    updated++;
  }

  console.log(`Ferdig - satte kategori på ${updated} produkter.`);
}

main()
  .catch((err) => {
    console.error("Feil under kategori-backfill:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
