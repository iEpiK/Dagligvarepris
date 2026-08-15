/**
 * Tynn wrapper rundt localStorage.token som varsler resten av appen når
 * innloggingsstatus endrer seg. Nødvendig fordi root-layouten (og dermed
 * f.eks. ConnectNavLink) IKKE remountes ved client-side navigasjon i Next.js
 * App Router - en komponent som bare sjekker localStorage i en useEffect med
 * tomme dependencies fanger derfor aldri opp en innlogging/utlogging som
 * skjer uten en faktisk sideendring (f.eks. steg-bytte på samme /connect-side).
 */

const AUTH_EVENT = "dagligvarepris:authchange";

export function getToken(): string | null {
  return localStorage.getItem("token");
}

export function setToken(token: string): void {
  localStorage.setItem("token", token);
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function clearToken(): void {
  localStorage.removeItem("token");
  window.dispatchEvent(new Event(AUTH_EVENT));
}

/** Kaller cb med det samme, og på nytt hver gang token settes/fjernes (også i andre faner). */
export function onAuthChange(cb: () => void): () => void {
  cb();
  window.addEventListener(AUTH_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(AUTH_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
