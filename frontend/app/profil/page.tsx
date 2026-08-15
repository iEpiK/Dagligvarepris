"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Connection, disconnectConnection, listConnections, syncConnection } from "@/lib/api";

const CHAIN_LABELS: Record<string, string> = {
  trumf: "Trumf (Kiwi, Meny, Spar, Joker)",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Aktiv",
  waiting_for_export: "Henter kvitteringer fra Trumf …",
  error: "Feil",
  disconnected: "Frakoblet",
};

export default function ProfilPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("token");
    if (!stored) {
      router.replace("/connect");
      return;
    }
    setToken(stored);
  }, [router]);

  useEffect(() => {
    if (!token) return;
    listConnections(token)
      .then(setConnections)
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSync(id: string) {
    if (!token) return;
    setBusyId(id);
    setMessage(null);
    try {
      await syncConnection(token, id);
      setMessage("Synk startet - det kan ta litt tid før nye kvitteringer dukker opp.");
      setConnections(await listConnections(token));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Synk feilet");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDisconnect(id: string) {
    if (!token) return;
    if (!confirm("Koble fra og slette all lagret data for denne kontoen? Dette kan ikke angres.")) return;
    setBusyId(id);
    setMessage(null);
    try {
      await disconnectConnection(token, id);
      setConnections((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Kunne ikke koble fra");
    } finally {
      setBusyId(null);
    }
  }

  function handleLogout() {
    localStorage.removeItem("token");
    router.replace("/");
  }

  if (!token) return null;

  return (
    <main className="container">
      <div style={{ padding: "48px 0 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>Min side</h1>
          <p className="helper-text">Dine tilkoblede kontoer og innstillinger.</p>
        </div>
        <button type="button" className="secondary" onClick={handleLogout}>
          Logg ut
        </button>
      </div>

      {message && <p className="helper-text">{message}</p>}

      {loading && <p className="empty-state">Laster …</p>}

      {!loading && connections.length === 0 && (
        <p className="empty-state">
          Du har ingen tilkoblede kontoer ennå. <Link href="/connect">Koble til Trumf</Link>.
        </p>
      )}

      {connections.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {connections.map((c) => (
            <div key={c.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div className="name">{CHAIN_LABELS[c.chain] ?? c.chain}</div>
                  <div className="meta">
                    {STATUS_LABELS[c.status] ?? c.status}
                    {c.lastSyncedAt && ` · sist synket ${new Date(c.lastSyncedAt).toLocaleString("nb-NO")}`}
                  </div>
                  {c.status === "error" && c.lastError && <p className="error-text">{c.lastError}</p>}
                  {c.status === "waiting_for_export" && (
                    <p className="helper-text">
                      Trumf forbereder en eksport av kjøpshistorikken din - dette tar normalt under en time. Kvitteringene dukker opp av seg selv, ingen handling nødvendig.
                    </p>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => handleSync(c.id)} disabled={busyId === c.id}>
                  {busyId === c.id ? "Jobber …" : "Synk nå"}
                </button>
                <button type="button" className="secondary" onClick={() => handleDisconnect(c.id)} disabled={busyId === c.id}>
                  Koble fra og slett data
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
