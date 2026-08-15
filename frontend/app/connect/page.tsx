"use client";

import { useEffect, useState } from "react";
import { login, signup, startTrumfLogin, submitTrumfOtp } from "@/lib/api";

type Step = "loading" | "auth" | "connect" | "otp" | "done";

export default function ConnectPage() {
  const [step, setStep] = useState<Step>("loading");
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [trumfPassword, setTrumfPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [pendingLoginId, setPendingLoginId] = useState<string | null>(null);
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
      const result = await startTrumfLogin(token, phoneNumber, trumfPassword);
      if (result.status === "connected") {
        setStep("done");
      } else {
        setPendingLoginId(result.pendingLoginId);
        setStep("otp");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke logge inn hos Trumf");
    } finally {
      setBusy(false);
    }
  }

  async function handleOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingLoginId) return;
    setError(null);
    setBusy(true);
    try {
      const token = localStorage.getItem("token")!;
      await submitTrumfOtp(token, pendingLoginId, otp);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Feil SMS-kode");
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
            kun de påfølgende tilgangs- og fornyingstokenene lagres, kryptert.
          </p>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" disabled={busy}>
            Logg inn hos Trumf
          </button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={handleOtp}>
          <div>
            <label htmlFor="otp">SMS-kode</label>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="6 siffer"
            />
          </div>
          <p className="helper-text">
            Trumf har sendt en engangskode på SMS til telefonnummeret du oppga. Skriv den inn under
            for å fullføre tilkoblingen.
          </p>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" disabled={busy}>
            Bekreft kode
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
