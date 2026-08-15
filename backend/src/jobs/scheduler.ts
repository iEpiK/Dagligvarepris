import cron from "node-cron";
import { prisma } from "../db";
import { syncTrumfConnection } from "../connectors/trumf/sync";

/**
 * Periodisk bakgrunnsjobb: går gjennom alle aktive tilkoblinger og henter
 * nye kvitteringer. Kjøres etter SYNC_CRON (default hver 6. time, se .env.example).
 * Dette er "auto-synk"-delen brukeren ba om - ingen manuell handling nødvendig
 * etter at kontoen er koblet til én gang.
 */
export function startScheduler(): void {
  const schedule = process.env.SYNC_CRON || "0 */6 * * *";

  cron.schedule(schedule, async () => {
    const connections = await prisma.chainConnection.findMany({
      where: { chain: "trumf", status: { not: "disconnected" } },
    });

    for (const connection of connections) {
      try {
        await syncTrumfConnection(connection.id);
      } catch (err) {
        console.error(`Synk feilet for tilkobling ${connection.id}:`, err);
      }
    }
  });

  console.log(`Bakgrunnssynk planlagt med cron-uttrykk: ${schedule}`);
}
