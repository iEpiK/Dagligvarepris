/**
 * Felles kontrakt for en enkel kjede-connector (kun brukernavn/passord, ett
 * steg). Trumf sin ekte flyt krever et ekstra SMS-steg (se
 * connectors/trumf/webAuth.ts) og har derfor sin egen, rikere form i stedet
 * for å implementere dette interfacet direkte. Bruk dette som mal for Rema/
 * Coop i fase 2 dersom de IKKE krever tilsvarende flertrinns-flyt.
 */

export interface ChainAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface NormalizedReceiptItem {
  rawName: string;
  ean?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface NormalizedReceipt {
  externalId: string;
  purchasedAt: Date;
  totalAmount: number;
  storeExternalId?: string;
  storeName?: string;
  storeChain?: string; // f.eks. "kiwi", "meny", "spar", "joker" for Trumf-kvitteringer
  rawPayload: unknown;
  items: NormalizedReceiptItem[];
}

export interface ChainConnector {
  chain: string;
  login(credentials: Record<string, string>): Promise<ChainAuthResult>;
  fetchReceipts(auth: ChainAuthResult, fromDate: Date, toDate: Date): Promise<NormalizedReceipt[]>;
}
