/**
 * Felles kontrakt for en kjede-connector, slik at Trumf, Rema og Coop kan
 * plugges inn på samme måte (fase 2 legger bare til nye mapper under
 * connectors/rema, connectors/coop som implementerer det samme).
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
