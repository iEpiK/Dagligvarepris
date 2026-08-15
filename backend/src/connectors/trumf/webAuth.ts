import crypto from "crypto";

/**
 * Web-innloggingsflyten for Trumf (client_id=trumf, brukt av www.trumf.no).
 *
 * I motsetning til Android-appens flyt (client_id=trumf.app) krever denne IKKE
 * Play Integrity-attestering - kun standard OAuth2 Authorization Code + PKCE,
 * med et telefonnummer+passord-steg og (normalt) et SMS-engangskode-steg.
 * Kartlagt og verifisert via nettleserens Network-fane 2026-08-15:
 *
 *   1. GET  /connect/authorize                  -> redirect til /trumfid/login (gir correlationId + returnUrl)
 *   2. POST /trumfid/login/validateUser          {"phoneNumber": "..."}
 *   3. POST /trumfid/login/pwd                   {"password": "...", "rememberMe": true}
 *   4. POST /trumfid/smsCode                     {"otp": "...", "rememberMeSms": true}   (kun hvis 2FA kreves)
 *   5. GET  returnUrl (=/connect/authorize/callback, ev. med &acr_values=cas:completed)
 *           -> redirect til www.trumf.no sin callback-URL med ?code=...
 *   6. POST /connect/token                       bytter koden (+ vår PKCE code_verifier) mot tokens
 *
 * Siden scope inkluderer "offline_access", trengs steg 1-6 kun ÉN gang per
 * bruker - deretter brukes refreshWebLogin() til periodisk bakgrunnssynk uten
 * noen ny SMS-bekreftelse.
 *
 * IKKE VERIFISERT (anta og test): at Bearer-prefixet er riktig format på
 * Authorization-headeren mot platform-rest-prod.ngdata.no, og at scopet vi får
 * her faktisk gir tilgang til /trumf/husstand/transaksjoner (kvitteringer) og
 * ikke bare saldo/medlemsdata. Se client.ts.
 */

const AUTH_BASE = "https://id.trumf.no";
const CLIENT_ID = "trumf";
const REDIRECT_URI = "https://www.trumf.no/api/auth/callback/trumf-personal";
const SCOPE = [
  "api.rest",
  "api.sylinder",
  "api.trumfid",
  "api.trumfid.biometri.administration",
  "api.trumfid.biometri.administration.read",
  "http://id.trumf.no/scopes/medlem",
  "offline_access",
  "openid",
  "profile",
].join(" ");

const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

class CookieJar {
  private cookies = new Map<string, string>();

  applyFrom(res: Response): void {
    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    const setCookieLines: string[] = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    for (const line of setCookieLines) {
      const pair = line.split(";")[0];
      const idx = pair.indexOf("=");
      if (idx === -1) continue;
      this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  /** Kun navnene, ikke verdiene - trygt å logge (verdiene er sesjons-/sikkerhetstokens). */
  names(): string[] {
    return Array.from(this.cookies.keys());
  }
}

/** Logger status, ev. redirect-mål og hvilke cookies vi har samlet så langt - uten å lekke cookie-verdier. */
function logStep(name: string, res: Response, cookies: CookieJar): void {
  const location = res.headers.get("location");
  console.error(
    `[trumf] ${name} -> HTTP ${res.status}${location ? `, Location: ${location}` : ""}, cookies nå: [${cookies.names().join(", ")}]`
  );
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function newPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export interface WebLoginTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: Date;
  scope?: string;
}

export interface PendingWebLogin {
  cookies: CookieJar;
  correlationId: string;
  returnUrl: string; // full sti+query til /connect/authorize/callback, gjenbrukes verbatim
  codeVerifier: string;
}

export type StartLoginResult =
  | { done: true; tokens: WebLoginTokens }
  | { done: false; pending: PendingWebLogin };

/** Steg 1-3: autoriser, send inn telefonnummer, send inn passord. */
export async function startWebLogin(phoneNumber: string, password: string): Promise<StartLoginResult> {
  const cookies = new CookieJar();
  const { verifier, challenge } = newPkcePair();
  const state = base64url(crypto.randomBytes(24));

  const authorizeParams = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    acr_values: "",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const authorizeRes = await fetch(`${AUTH_BASE}/connect/authorize?${authorizeParams.toString()}`, {
    headers: COMMON_HEADERS,
    redirect: "manual",
  });
  cookies.applyFrom(authorizeRes);
  logStep("connect/authorize", authorizeRes, cookies);

  const loginLocation = authorizeRes.headers.get("location");
  if (!loginLocation) {
    throw new Error("Trumf: forventet redirect fra /connect/authorize, fikk ingen Location-header");
  }
  const loginUrl = new URL(loginLocation, AUTH_BASE);
  const correlationId = loginUrl.searchParams.get("correlationId");
  const returnUrl = loginUrl.searchParams.get("returnUrl");
  if (!correlationId || !returnUrl) {
    throw new Error("Trumf: fant ikke correlationId/returnUrl i redirect fra /connect/authorize");
  }

  const loginRes = await fetch(loginUrl.toString(), {
    headers: { ...COMMON_HEADERS, Cookie: cookies.header() },
    redirect: "manual",
  });
  cookies.applyFrom(loginRes);
  logStep("trumfid/login", loginRes, cookies);

  const stepParams = new URLSearchParams({ correlationId, returnUrl });

  const validateRes = await fetch(`${AUTH_BASE}/trumfid/login/validateUser?${stepParams.toString()}`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json", Cookie: cookies.header() },
    body: JSON.stringify({ phoneNumber }),
  });
  cookies.applyFrom(validateRes);
  logStep("trumfid/login/validateUser", validateRes, cookies);
  if (!validateRes.ok) {
    throw new Error(`Trumf: ukjent telefonnummer eller feil ved validering (HTTP ${validateRes.status})`);
  }

  const pwdRes = await fetch(`${AUTH_BASE}/trumfid/login/pwd?${stepParams.toString()}`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json", Cookie: cookies.header() },
    body: JSON.stringify({ password, rememberMe: true }),
  });
  cookies.applyFrom(pwdRes);
  logStep("trumfid/login/pwd", pwdRes, cookies);
  if (!pwdRes.ok) {
    throw new Error(`Trumf: feil passord (HTTP ${pwdRes.status})`);
  }

  const pending: PendingWebLogin = { cookies, correlationId, returnUrl, codeVerifier: verifier };

  // En fersk backend-sesjon har aldri et "husket enhet"-cookie fra før, så
  // Trumf krever alltid SMS-bekreftelse her - ingen vits i å spekulativt
  // prøve callback-et før SMS er sendt inn (og et for tidlig kall risikerer å
  // rote til server-sesjonstilstanden før vi i det hele tatt trenger den).
  return { done: false, pending };
}

/** Steg 4-6: fullfør innloggingen med SMS-koden brukeren har mottatt. */
export async function completeWebLoginWithOtp(pending: PendingWebLogin, otp: string): Promise<WebLoginTokens> {
  // Viktig: Trumf sin egen nettside oppdaterer returnUrl til å inneholde
  // acr_values=cas:completed FØR SMS-koden sendes inn (bekreftet fra ekte
  // trafikk) - det er tydeligvis denne verdien som forteller serveren at
  // steg-up-en er fullført når vi senere henter autorisasjonskoden. Bruker vi
  // fortsatt den opprinnelige (tomme) returnUrl-en her, godtar serveren SMS-
  // koden greit, men callback-kallet gir aldri noen kode etterpå.
  const returnUrlWithStepUp = withAcrValues(pending.returnUrl, "cas:completed");

  const stepParams = new URLSearchParams({
    correlationId: pending.correlationId,
    returnUrl: returnUrlWithStepUp,
  });

  const smsRes = await fetch(`${AUTH_BASE}/trumfid/smsCode?${stepParams.toString()}`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json", Cookie: pending.cookies.header() },
    body: JSON.stringify({ otp, rememberMeSms: true }),
  });
  pending.cookies.applyFrom(smsRes);
  logStep("trumfid/smsCode", smsRes, pending.cookies);
  const smsBodyText = await smsRes.text().catch(() => "");
  console.error(`[trumf] smsCode body: ${smsBodyText.slice(0, 300) || "(tom)"}`);
  if (!smsRes.ok) {
    throw new Error(`Trumf: feil SMS-kode (HTTP ${smsRes.status})`);
  }

  // Etter vellykket SMS-bekreftelse ber Trumf normalt om å registrere
  // biometrisk pålogging for denne "enheten" (redirect: "/ui/registerbiometric?...").
  // Vi ønsker aldri det for en backend-tjeneste, så vi hopper alltid over det -
  // uten dette steget forblir sesjonen i en mellomtilstand og callback-et
  // under gir aldri noen autorisasjonskode.
  let smsBody: { redirect?: string } = {};
  try {
    smsBody = JSON.parse(smsBodyText);
  } catch {
    /* ingen gyldig JSON - behandles som "ingen redirect oppgitt" under */
  }

  if (smsBody.redirect?.toLowerCase().includes("registerbiometric")) {
    const skipParams = new URLSearchParams({
      correlationId: pending.correlationId,
      returnUrl: returnUrlWithStepUp,
    });
    const skipRes = await fetch(`${AUTH_BASE}/trumfid/biometri/registration/skip?${skipParams.toString()}`, {
      headers: { ...COMMON_HEADERS, Cookie: pending.cookies.header() },
      redirect: "manual",
    });
    pending.cookies.applyFrom(skipRes);
    logStep("trumfid/biometri/registration/skip", skipRes, pending.cookies);
  }

  const result = await tryGetAuthorizationCode(pending, returnUrlWithStepUp);
  if (!result.code) {
    throw new Error(`Trumf: fikk ikke noen autorisasjonskode selv etter SMS-bekreftelse (${result.debug})`);
  }

  return exchangeCodeForTokens(result.code, pending.codeVerifier);
}

/** Setter/overskriver acr_values i en returnUrl-streng, og gir tilbake en relativ sti+query. */
function withAcrValues(returnUrl: string, acrValues: string): string {
  const url = new URL(returnUrl, AUTH_BASE);
  url.searchParams.set("acr_values", acrValues);
  return url.pathname + url.search;
}

interface CallbackAttempt {
  code: string | null;
  /** Menneskelesbar diagnose - fylt ut når code er null, så feilen faktisk kan feilsøkes uten server-tilgang. */
  debug: string;
}

async function tryGetAuthorizationCode(pending: PendingWebLogin, returnUrl: string): Promise<CallbackAttempt> {
  const callbackUrl = new URL(returnUrl, AUTH_BASE);
  callbackUrl.searchParams.set("correlationId", pending.correlationId);

  const res = await fetch(callbackUrl.toString(), {
    headers: { ...COMMON_HEADERS, Cookie: pending.cookies.header() },
    redirect: "manual",
  });
  pending.cookies.applyFrom(res);
  logStep("connect/authorize/callback", res, pending.cookies);

  const location = res.headers.get("location");
  if (!location) {
    const bodySnippet = (await res.text().catch(() => "")).slice(0, 500);
    return { code: null, debug: `HTTP ${res.status} ${res.statusText}, ingen Location-header. Body: ${bodySnippet || "(tom)"}` };
  }

  const redirectUrl = new URL(location, REDIRECT_URI);
  const code = redirectUrl.searchParams.get("code");
  if (!code) {
    return { code: null, debug: `Fikk redirect til "${location}", men ingen code-parameter der` };
  }

  return { code, debug: "" };
}

async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<WebLoginTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
    client_id: CLIENT_ID,
  });

  const res = await fetch(`${AUTH_BASE}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...COMMON_HEADERS },
    body: body.toString(),
  });

  const responseText = await res.text();
  console.error(`[trumf] connect/token -> HTTP ${res.status}, body: ${responseText.slice(0, 500) || "(tom)"}`);

  if (!res.ok) {
    throw new Error(`Trumf: token-utveksling feilet (HTTP ${res.status}): ${responseText.slice(0, 300)}`);
  }

  const data = JSON.parse(responseText) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
    scope?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
  };
}

/** Bytter et lagret refresh-token mot et nytt access-token - ingen ny SMS kreves. */
export async function refreshWebLogin(refreshToken: string): Promise<WebLoginTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  const res = await fetch(`${AUTH_BASE}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...COMMON_HEADERS },
    body: body.toString(),
  });

  const responseText = await res.text();
  console.error(`[trumf] refresh connect/token -> HTTP ${res.status}, body: ${responseText.slice(0, 500) || "(tom)"}`);

  if (!res.ok) {
    throw new Error(
      `Trumf: refresh av token feilet (HTTP ${res.status}) - kontoen må trolig kobles til på nytt: ${responseText.slice(0, 300)}`
    );
  }

  const data = JSON.parse(responseText) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
  };
}
