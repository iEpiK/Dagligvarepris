"use client";

import { useEffect, useState } from "react";
import { connectTrumf, login, signup } from "@/lib/api";

type Step = "loading" | "auth" | "connect" | "done";

export default function ConnectPage() {
  const [step, setStep] = useState<Step>("loading");
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [trumfPassword, setTrumfPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    setStep(token ? "connect" : "auth");
  }, []);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const token = mode === "signup" ? await signup(email, password) : await login(email, password);
      localStorage.setItem("token", token);
      setStep("connect");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Noe gikk galt");
    } finally {
      setBusy(false);
    }
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const token = localStorage.getItem("token")!;
      await connectTrumf(token, phoneNumber, trumfPassword);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke koble til Trumf");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <div style={{ padding: "48px 0 24px", maxWidth: 460 }}>
        <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>Koble til Trumf</h1>
        <p className="helper-text">
          Vi henter kjøpshistorikken din automatisk i bakgrunnen fra nå av – ingen manuell
          opplasting. Du kan koble fra og slette dataene dine når som helst.
        </p>
      </div>

      {step === "auth" && (
        <form onSubmit={handleAuth}>
          <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
            <button
              type="button"
              className={mode === "signup" ? "" : "secondary"}
              onClick={() => setMode("signup")}
            >
              Ny bruker
            </button>
            <button
              type="button"
              className={mode === "login" ? "" : "secondary"}
              onClick={() => setMode("login")}
            >
              Logg inn
            </button>
          </div>
          <div>
            <label htmlFor="email">E-post</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="password">Passord</label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" disabled={busy}>
            {mode === "signup" ? "Opprett konto" : "Logg inn"}
          </button>
        </form>
      )}

      {step === "connect" && (
        <form onSubmit={handleConnect}>
          <div>
            <label htmlFor="phone">Telefonnummer (Trumf-konto)</label>
            <input
              id="phone"
              type="tel"
              required
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="trumfPassword">Passord (Trumf-konto)</label>
            <input
              id="trumfPassword"
              type="password"
              required
              value={trumfPassword}
              onChange={(e) => setTrumfPassword(e.target.value)}
            />
          </div>
          <p className="helper-text">
            Passordet ditt sendes direkte til Trumf sitt innloggingskall og lagres aldri hos oss –
            kun den påfølgende tilgangstokenen lagres, kryptert.
          </p>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" disabled={busy}>
            Koble til
          </button>
        </form>
      )}

      {step === "done" && (
        <div className="card">
          <p style={{ margin: 0 }}>
            Kontoen er koblet til. Vi henter kvitteringene dine i bakgrunnen – prisene dukker opp
            i søket etter hvert som de er behandlet.
          </p>
        </div>
      )}
    </main>
  );
}
