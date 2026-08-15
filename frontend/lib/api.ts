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
