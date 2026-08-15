const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export interface Product {
  id: string;
  name: string;
  category: string | null;
}

export interface PricePoint {
  chain: string;
  storeName: string | null;
  price: number;
  observedAt: string;
}

export async function searchProducts(query: string): Promise<Product[]> {
  if (!query.trim()) return [];
  const res = await fetch(`${API_URL}/products?q=${encodeURIComponent(query)}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.products;
}

export interface Category {
  category: string;
  count: number;
}

export async function listCategories(): Promise<Category[]> {
  const res = await fetch(`${API_URL}/products/categories`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  return data.categories;
}

export async function listProductsByCategory(
  category: string,
  page = 1
): Promise<{ products: Product[]; hasMore: boolean }> {
  const res = await fetch(
    `${API_URL}/products?category=${encodeURIComponent(category)}&page=${page}`,
    { cache: "no-store" }
  );
  if (!res.ok) return { products: [], hasMore: false };
  const data = await res.json();
  return { products: data.products, hasMore: data.hasMore };
}

export async function getProduct(id: string) {
  const res = await fetch(`${API_URL}/products/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export async function getPriceHistory(id: string, days = 365): Promise<PricePoint[]> {
  const res = await fetch(`${API_URL}/products/${id}/prices?days=${days}`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  return data.series;
}

export type StartTrumfLoginResult =
  | { status: "connected" }
  | { status: "otp_required"; pendingLoginId: string };

export async function startTrumfLogin(
  token: string,
  phoneNumber: string,
  password: string
): Promise<StartTrumfLoginResult> {
  const res = await fetch(`${API_URL}/connections/trumf/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ phoneNumber, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Kunne ikke logge inn hos Trumf");
  return data;
}

export async function submitTrumfOtp(token: string, pendingLoginId: string, otp: string) {
  const res = await fetch(`${API_URL}/connections/trumf/otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pendingLoginId, otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Feil SMS-kode");
  return data;
}

export async function signup(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Kunne ikke opprette bruker");
  return data.token;
}

export interface Connection {
  id: string;
  chain: string;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export async function listConnections(token: string): Promise<Connection[]> {
  const res = await fetch(`${API_URL}/connections`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.connections;
}

export async function syncConnection(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_URL}/connections/${id}/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Synk feilet");
}

export async function disconnectConnection(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_URL}/connections/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Kunne ikke koble fra");
}

export async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Innlogging feilet");
  return data.token;
}
