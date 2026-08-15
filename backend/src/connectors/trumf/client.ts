import {
  ChainAuthResult,
  ChainConnector,
  NormalizedReceipt,
} from "../types";
import { TrumfTransaksjon, TrumfTransaksjonDetaljer } from "./types";

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

export class TrumfConnector implements ChainConnector {
  chain = "trumf";

  /**
   * IKKE VERIFISERT MOT EKTE TRUMF-INNLOGGING.
   *
   * Transaksjons- og detalj-endepunktene under er bekreftet fra kildene i
   * README (ttyridal/trumf-data-fetch), men selve login-kallet som bytter
   * telefonnummer+passord mot en gyldig `Authorization`-verdi er IKKE
   * dokumentert i de kildene jeg fant. Du må fange dette kallet selv med
   * f.eks. mitmproxy (se README) og fylle inn riktig URL/body/token-parsing
   * her før dette kan brukes i produksjon.
   *
   * Kaster med vilje en tydelig feil inntil dette er gjort, i stedet for å
   * late som det virker.
   */
  async login(_credentials: { phoneNumber: string; password: string }): Promise<ChainAuthResult> {
    throw new Error(
      "TrumfConnector.login() er ikke koblet til et verifisert endepunkt ennå. " +
        "Se README.md #slik-finner-du-innloggings-endepunktet."
    );

    // Eksempel på hvordan resultatet skal se ut når du har fylt inn ekte kall:
    // const response = await fetch("https://<verifisert-login-url>", {
    //   method: "POST",
    //   headers: COMMON_HEADERS,
    //   body: JSON.stringify({ phoneNumber: credentials.phoneNumber, password: credentials.password }),
    // });
    // const data = await response.json();
    // return {
    //   accessToken: data.token,
    //   expiresAt: new Date(Date.now() + 1000 * 60 * 60), // juster etter faktisk levetid
    // };
  }

  async fetchReceipts(auth: ChainAuthResult, fromDate: Date, toDate: Date): Promise<NormalizedReceipt[]> {
    const params = new URLSearchParams({
      felter: TRANSAKSJON_FELTER,
      fra: formatDate(fromDate),
      til: formatDate(toDate),
      format: "crm",
    });

    const listResponse = await fetch(`${BASE_URL}/transaksjoner?${params.toString()}`, {
      headers: { ...COMMON_HEADERS, Authorization: auth.accessToken },
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
        { headers: { ...COMMON_HEADERS, Authorization: auth.accessToken } }
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
