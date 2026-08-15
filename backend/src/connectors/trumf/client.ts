import AdmZip from "adm-zip";
import { NormalizedReceipt } from "../types";
import { TrumfEksportKvittering } from "./types";
import { WebLoginTokens, refreshWebLogin, getMemberIdFromAccessToken } from "./webAuth";

/**
 * Henter faktiske kvitteringer via Trumf sin GDPR-databehandler-eksport
 * ("Innsyn og utlevering" på www.trumf.no/profil/innsyn-og-utlevering).
 *
 * Dette er en TO-STEGS, ASYNKRON prosess (bekreftet fra ekte nettleser-
 * trafikk 2026-08-15) - det finnes IKKE noe synkront "hent kvitteringer nå"-
 * endepunkt som gir varelinjer. De tidligere forsøkte endepunktene
 * (platform-rest-prod.ngdata.no/trumf/husstand/transaksjoner[/detaljer/...])
 * er bekreftet døde (404) - dette her er den ekte kilden til per-vare-data:
 *
 *   1. POST platform-rest-prod.ngdata.no/innsyn
 *      Bestiller eksporten. Svarer 201 Created uten data i selve svaret.
 *      Trumf sier selv i UI-et at filen er klar for nedlasting "innen 1 time".
 *   2. GET  www.trumf.no/api/common/orderinsight/getfiles?isDataportability=true
 *      Når eksporten er klar: 200 OK med en ZIP-fil (content-type:
 *      application/zip) som inneholder én JSON-fil med kvitteringene,
 *      INKLUDERT varelinjer (varenavn, antall/vekt, beløp).
 *
 * Begge kallene autentiseres med det samme Bearer-access-tokenet vi allerede
 * henter fra www.trumf.no/api/auth/session - bekreftet fra ekte
 * request-headere (IKKE cookie-basert, i motsetning til RSC-endepunktene
 * som ble vurdert og forkastet før dette).
 *
 * Siden ventetiden (~1t) er lengre enn ett enkelt synk-kall bør vare, er
 * dette splittet i to faser drevet av SYNC_CRON (se sync.ts): første synk-
 * runde bestiller eksporten og lagrer et tidsstempel på ChainConnection, en
 * SENERE runde (neste cron-syklus, som standard hver 6. time) henter den
 * ferdige filen.
 */

const INNSYN_URL = "https://platform-rest-prod.ngdata.no/innsyn";
const GETFILES_URL = "https://www.trumf.no/api/common/orderinsight/getfiles?isDataportability=true";

const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "*/*",
};

export class TrumfConnector {
  chain = "trumf";

  /** Bytter et lagret refresh-token mot et ferskt access-token. Ingen SMS kreves. */
  async refreshAccessToken(refreshToken: string): Promise<WebLoginTokens> {
    return refreshWebLogin(refreshToken);
  }

  /** Steg 1: bestill en fersk eksport av kjøpshistorikk med varelinjer hos Trumf. */
  async requestExport(accessToken: string): Promise<void> {
    const medlemId = getMemberIdFromAccessToken(accessToken);
    if (!medlemId) {
      throw new Error("Trumf: fant ikke medlems-id i access-tokenet - kan ikke bestille eksport");
    }

    const res = await fetch(INNSYN_URL, {
      method: "POST",
      headers: { ...COMMON_HEADERS, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        medlemId,
        format: "JSON",
        periode: "SISTE_3_AR",
        onskerProfil: false,
        onskerDigitalHistorikk: false,
        onskerDialoghistorikk: false,
        onskerOrdrehistorikk: false,
        onskerSalgshistorikk: false,
        onskerSalgshistorikkPerHandel: true,
      }),
    });

    if (res.status !== 201) {
      const bodySnippet = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`Trumf: kunne ikke bestille eksport (HTTP ${res.status}): ${bodySnippet || "(tom)"}`);
    }
  }

  /**
   * Steg 2: prøv å hente den bestilte eksporten. Returnerer null hvis den
   * ikke er klar ennå - dette er IKKE en feil, bare prøv igjen neste
   * synk-runde (se sync.ts).
   */
  async fetchExportIfReady(accessToken: string): Promise<NormalizedReceipt[] | null> {
    const res = await fetch(GETFILES_URL, {
      headers: { ...COMMON_HEADERS, Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 404 || res.status === 204) {
      return null; // ikke klar ennå
    }
    if (!res.ok) {
      throw new Error(`Trumf: uventet svar ved henting av eksport (HTTP ${res.status})`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = new AdmZip(buffer);
    const jsonEntry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith(".json"));
    if (!jsonEntry) {
      throw new Error("Trumf: eksport-zip-en inneholdt ingen JSON-fil");
    }

    const kvitteringer = JSON.parse(jsonEntry.getData().toString("utf8")) as TrumfEksportKvittering[];
    return kvitteringer.map(normalizeKvittering);
  }
}

function normalizeKvittering(k: TrumfEksportKvittering): NormalizedReceipt {
  return {
    externalId: k.kvitteringsnummer,
    purchasedAt: parseNorwegianDate(k.dato),
    totalAmount: Number(k.totaltBelop),
    storeName: k.butikknavn,
    storeExternalId: k.kjede ?? k.butikknavn,
    storeChain: guessUnderlyingChain(k.butikknavn),
    rawPayload: k,
    items: k.varelinjer.map((v) => {
      const quantity = Number(v.vareAntallVekt);
      const totalPrice = Number(v.vareBelop);
      return {
        rawName: v.varenavn,
        quantity,
        unitPrice: quantity ? totalPrice / quantity : totalPrice,
        totalPrice,
      };
    }),
  };
}

/** "DD.MM.YYYY" -> Date. Eksporten bruker norsk datoformat, ikke ISO. */
function parseNorwegianDate(d: string): Date {
  const [day, month, year] = d.split(".").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Trumf dekker flere underkjeder (NorgesGruppen) - gjett ut fra butikknavnet. */
function guessUnderlyingChain(storeName: string): string {
  const lower = storeName.toLowerCase();
  if (lower.includes("kiwi")) return "kiwi";
  if (lower.includes("meny")) return "meny";
  if (lower.includes("spar")) return "spar";
  if (lower.includes("joker")) return "joker";
  return "ukjent";
}
