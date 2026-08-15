/** Rå responsformer fra det uoffisielle Trumf-endepunktet, se README for kilder. */

export interface TrumfTransaksjon {
  dato: string; // ISO-dato
  beskrivelse: string; // butikknavn
  kjedeid?: string;
  partnerid?: string;
  batchid: string; // brukes som eksternId + til å hente detaljer
  belop: number;
  trumftotal?: number;
}

export interface TrumfVarelinje {
  vareTekst: string;
  ean?: string;
  antall: number;
  belop: number;
}

export interface TrumfTransaksjonDetaljer {
  varelinjer: TrumfVarelinje[];
}
