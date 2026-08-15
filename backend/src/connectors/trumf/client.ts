import { NormalizedReceipt } from "../types";
import { TrumfTransaksjon, TrumfTransaksjonDetaljer } from "./types";
import { WebLoginTokens, refreshWebLogin } from "./webAuth";

/**
 * Henter faktiske kvitteringer fra det uoffisielle, men bekreftede,
 * transaksjons-endepunktet. Innlogging skjer separat via webAuth.ts
 * (se routes/connections.ts) - denne klassen tar kun imot et ferdig
 * access-token og bruker det.
 */

const BASE_URL = "https://platform-rest-prod.ngdata.no/trumf/husstand";

const COMMON_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:68.0) Gecko/20100101 Firefox/68.0",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.5",
  "Content-type": "application/json",
};

const TRANSAKSJON_FELTER = [
  "dato",
  "beskrivelse",
  "kjedeid",
  "partnerid",
  "batchid",
  "belop",
  "trumf",
  "ekstratrumf",
  "trumfvisa",
  "literbensin",
  "trumftotal",
].join(",");

export class TrumfConnector {
  chain = "trumf";

  /** Bytter et lagret refresh-token mot et ferskt access-token. Ingen SMS kreves. */
  async refreshAccessToken(refreshToken: string): Promise<WebLoginTokens> {
    return refreshWebLogin(refreshToken);
  }

  async fetchReceipts(accessToken: string, fromDate: Date, toDate: Date): Promise<NormalizedReceipt[]> {
    const params = new URLSearchParams({
      felter: TRANSAKSJON_FELTER,
      fra: formatDate(fromDate),
      til: formatDate(toDate),
      format: "crm",
    });

    // IKKE VERIFISERT: at "Bearer "-prefikset er riktig format på access-tokenet
    // fra web-innloggingen (client_id=trumf) mot dette endepunktet, og at scopet
    // vi fikk faktisk dekker transaksjonshistorikk og ikke bare saldo/medlemsdata.
    // Test dette først med ett ekte kall før du stoler på output.
    const authHeader = `Bearer ${accessToken}`;

    const listResponse = await fetch(`${BASE_URL}/transaksjoner?${params.toString()}`, {
      headers: { ...COMMON_HEADERS, Authorization: authHeader },
    });

    if (!listResponse.ok) {
      throw new Error(`Trumf: kunne ikke hente transaksjonsliste (HTTP ${listResponse.status})`);
    }

    const transaksjoner = (await listResponse.json()) as TrumfTransaksjon[];

    const receipts: NormalizedReceipt[] = [];

    for (const t of transaksjoner) {
      // Kun faktiske dagligvarekjøp har varelinjer å hente ut - hopp over feil/tomme rader.
      if (!t.batchid) continue;

      const detailsResponse = await fetch(
        `${BASE_URL}/transaksjoner/detaljer/${encodeURIComponent(t.batchid)}`,
        { headers: { ...COMMON_HEADERS, Authorization: authHeader } }
      );

      if (!detailsResponse.ok) {
        // Ikke la én ødelagt kvittering stoppe hele synken.
        continue;
      }

      const details = (await detailsResponse.json()) as TrumfTransaksjonDetaljer;

      receipts.push({
        externalId: t.batchid,
        purchasedAt: new Date(t.dato),
        totalAmount: t.belop,
        storeName: t.beskrivelse,
        storeExternalId: t.kjedeid ?? t.partnerid,
        storeChain: guessUnderlyingChain(t.beskrivelse),
        rawPayload: { transaksjon: t, detaljer: details },
        items: (details.varelinjer ?? []).map((v) => ({
          rawName: v.vareTekst,
          ean: v.ean,
          quantity: v.antall,
          unitPrice: v.antall ? v.belop / v.antall : v.belop,
          totalPrice: v.belop,
        })),
      });
    }

    return receipts;
  }
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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
