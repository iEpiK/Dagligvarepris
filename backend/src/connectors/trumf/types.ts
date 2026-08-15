/**
 * Rå responsform fra Trumf sin GDPR-databehandler-eksport ("Innsyn og
 * utlevering" på www.trumf.no/profil/innsyn-og-utlevering). Bekreftet fra
 * ekte data 2026-08-15 - se client.ts for hvordan dette hentes (to-stegs,
 * asynkron prosess).
 */

export interface TrumfEksportVarelinje {
  varenavn: string;
  /** Streng med tre desimaler - antall stk, ELLER vekt i kg for løsvarer (f.eks "0.918"). */
  vareAntallVekt: string;
  /** Streng med to desimaler, kr. Linjens totalbeløp (kan være negativt for rabatter/panttrekk). */
  vareBelop: string;
}

export interface TrumfEksportKvittering {
  /** "DD.MM.YYYY" - IKKE ISO-format. */
  dato: string;
  kvitteringsnummer: string;
  kjede: string | null;
  butikknavn: string;
  totaltBelop: string;
  korttype: string | null;
  kanal: string | null;
  varelinjer: TrumfEksportVarelinje[];
}
