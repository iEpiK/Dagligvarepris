import crypto from "crypto";
import { PendingWebLogin } from "./webAuth";

/**
 * Midlertidig, in-memory lagring av pågående Trumf-innlogginger mens vi
 * venter på at brukeren taster inn SMS-koden. Bevisst IKKE i databasen -
 * dette er kortlevd (noen minutter) og trenger ikke overleve en omstart.
 *
 * Merk: fungerer kun når backend kjører som én prosess (slik den gjør i
 * docker-compose-oppsettet). Ved horisontal skalering må dette flyttes til
 * f.eks. Redis.
 */

interface StoredPendingLogin {
  userId: string;
  pending: PendingWebLogin;
  expiresAt: number;
}

const store = new Map<string, StoredPendingLogin>();
const TTL_MS = 5 * 60 * 1000; // 5 minutter til å taste inn SMS-koden

export function savePendingLogin(userId: string, pending: PendingWebLogin): string {
  cleanup();
  const id = crypto.randomUUID();
  store.set(id, { userId, pending, expiresAt: Date.now() + TTL_MS });
  return id;
}

/** Engangsbruk: fjerner og returnerer den lagrede tilstanden, hvis den finnes og eies av brukeren. */
export function takePendingLogin(userId: string, id: string): PendingWebLogin | undefined {
  cleanup();
  const entry = store.get(id);
  if (!entry || entry.userId !== userId) return undefined;
  store.delete(id);
  return entry.pending;
}

function cleanup(): void {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expiresAt < now) store.delete(id);
  }
}
