/**
 * Web-innloggingsflyten for Trumf (client_id=trumf, brukt av www.trumf.no).
 *
 * VIKTIG ARKITEKTURENDRING (2026-08-15): Vi bytter IKKE lenger autorisasjons-
 * koden mot tokens selv (POST id.trumf.no/connect/token). Det ga alltid
 * "invalid_client" - client_id=trumf er en konfidensiell OAuth-klient som
 * krever en client_secret kun www.trumf.no sin egen backend har (den flyten
 * kjører aldri i nettleseren, derfor så vi den aldri i trafikken).
 *
 * I stedet lar vi www.trumf.no sin egen Auth.js (NextAuth)-installasjon gjøre
 * hele token-byttet for oss, ved å starte innloggingen fra DERES egne
 * endepunkter i stedet for å bygge vårt eget /connect/authorize-kall:
 *
 *   1. GET  www.trumf.no/api/auth/csrf                     -> {csrfToken} + csrf-cookie
 *   2. POST www.trumf.no/api/auth/signin/trumf-personal     csrfToken=...
 *           -> redirect til id.trumf.no/connect/authorize (Auth.js sin egen
 *              state/PKCE, satt som cookies på www.trumf.no vi bare viderefører)
 *   3. GET  id.trumf.no/connect/authorize                   -> redirect til /trumfid/login (correlationId+returnUrl)
 *   4. POST id.trumf.no/trumfid/login/validateUser           {"phoneNumber": "..."}
 *   5. POST id.trumf.no/trumfid/login/pwd                    {"password": "...", "rememberMe": true}
 *   6. POST id.trumf.no/trumfid/smsCode                      {"otp": "...", "rememberMeSms": true}
 *   7. GET  returnUrl (+acr_values=cas:completed)             -> redirect med ?code=...&state=...
 *           -> redirect videre til www.trumf.no/api/auth/callback/trumf-personal
 *   8. GET  www.trumf.no/api/auth/callback/trumf-personal     Auth.js bytter koden mot tokens SERVER-SIDE
 *           (med sin egen client_secret) og setter en authjs.session-token-cookie
 *   9. GET  www.trumf.no/api/auth/session                     -> {"accessToken": "...", "idToken": "...", ...}
 *
 * Bekreftet med ekte data 2026-08-15: /api/auth/session ga et reelt
 * access_token utstedt av id.trumf.no for client_id=trumf med riktig scope.
 *
 * "refreshToken" i denne modulen er derfor IKKE et ekte OAuth refresh_token -
 * det er en seriealisert cookie-header-streng for www.trumf.no
 * (authjs.session-token m.fl.). Sesjonen varer ~1 år (se "expires" i
 * /api/auth/session-responsen), mens selve access_token kun varer 1 time -
 * Auth.js fornyer det trolig automatisk server-side ved neste kall til
 * /api/auth/session, siden refresh_token aldri eksponeres til klienten.
 *
 * IKKE VERIFISERT ENNÅ: at scopet vi får faktisk gir tilgang til
 * /trumf/husstand/transaksjoner (kvitteringer) og ikke bare saldo/medlemsdata.
 * Se client.ts.
 */

const ID_BASE = "https://id.trumf.no";
const AUTHJS_BASE = "https://www.trumf.no";
const PROVIDER_ID = "trumf-personal";

const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

class CookieJar {
  private cookies = new Map<string, string>();

  static fromHeader(header: string): CookieJar {
    const jar = new CookieJar();
    for (const part of header.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      jar.cookies.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
    }
    return jar;
  }

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

/** Leser payloadet fra en JWT uten å verifisere signaturen (vi stoler på at Trumf sin server utstedte den). */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const payloadB64Url = jwt.split(".")[1];
    const payloadB64 = payloadB64Url.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeJwtExpiry(jwt: string): Date | null {
  const exp = decodeJwtPayload(jwt)?.exp;
  return typeof exp === "number" ? new Date(exp * 1000) : null;
}

/**
 * Henter medlems-id-claimet fra access-tokenet (kreves for å bestille GDPR-
 * databehandler-eksporten med varelinjer, se client.ts sin requestExport).
 */
export function getMemberIdFromAccessToken(accessToken: string): string | null {
  const claim = decodeJwtPayload(accessToken)?.["http://id.trumf.no/claims/medlem"];
  return typeof claim === "string" ? claim : null;
}

export interface WebLoginTokens {
  accessToken: string;
  /** Ikke et ekte OAuth refresh_token - se modul-kommentaren øverst. Seriealisert www.trumf.no-cookie-header. */
  refreshToken?: string;
  idToken?: string;
  expiresAt: Date;
  scope?: string;
}

export interface PendingWebLogin {
  idCookies: CookieJar;
  authjsCookies: CookieJar;
  correlationId: string;
  returnUrl: string; // full sti+query til /connect/authorize/callback, gjenbrukes verbatim
}

export type StartLoginResult =
  | { done: true; tokens: WebLoginTokens }
  | { done: false; pending: PendingWebLogin };

/** Steg 1-5: start innlogging via Auth.js på www.trumf.no, send inn telefonnummer, send inn passord. */
export async function startWebLogin(phoneNumber: string, password: string): Promise<StartLoginResult> {
  const authjsCookies = new CookieJar();
  const idCookies = new CookieJar();

  const csrfRes = await fetch(`${AUTHJS_BASE}/api/auth/csrf`, { headers: COMMON_HEADERS });
  authjsCookies.applyFrom(csrfRes);
  logStep("api/auth/csrf", csrfRes, authjsCookies);
  if (!csrfRes.ok) {
    throw new Error(`Trumf: fikk ikke csrf-token fra www.trumf.no (HTTP ${csrfRes.status})`);
  }
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const signinBody = new URLSearchParams({
    csrfToken,
    callbackUrl: `${AUTHJS_BASE}/`,
  });
  const signinRes = await fetch(`${AUTHJS_BASE}/api/auth/signin/${PROVIDER_ID}`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/x-www-form-urlencoded", Cookie: authjsCookies.header() },
    body: signinBody.toString(),
    redirect: "manual",
  });
  authjsCookies.applyFrom(signinRes);
  logStep("api/auth/signin/" + PROVIDER_ID, signinRes, authjsCookies);

  let authorizeUrl = signinRes.headers.get("location");
  if (!authorizeUrl && signinRes.ok) {
    // Fallback: enkelte Auth.js-oppsett svarer med JSON {url:...} i stedet for redirect.
    const body = (await signinRes.json().catch(() => null)) as { url?: string } | null;
    authorizeUrl = body?.url ?? null;
  }
  if (!authorizeUrl) {
    const bodySnippet = (await signinRes.text().catch(() => "")).slice(0, 400);
    throw new Error(
      `Trumf: fikk ingen redirect til id.trumf.no fra www.trumf.no sin innloggingsstart (HTTP ${signinRes.status}). Body: ${bodySnippet || "(tom)"}`
    );
  }

  const authorizeRes = await fetch(new URL(authorizeUrl, AUTHJS_BASE).toString(), {
    headers: COMMON_HEADERS,
    redirect: "manual",
  });
  idCookies.applyFrom(authorizeRes);
  logStep("connect/authorize", authorizeRes, idCookies);

  const loginLocation = authorizeRes.headers.get("location");
  if (!loginLocation) {
    throw new Error("Trumf: forventet redirect fra /connect/authorize, fikk ingen Location-header");
  }
  const loginUrl = new URL(loginLocation, ID_BASE);
  const correlationId = loginUrl.searchParams.get("correlationId");
  const returnUrl = loginUrl.searchParams.get("returnUrl");
  if (!correlationId || !returnUrl) {
    throw new Error("Trumf: fant ikke correlationId/returnUrl i redirect fra /connect/authorize");
  }

  const loginRes = await fetch(loginUrl.toString(), {
    headers: { ...COMMON_HEADERS, Cookie: idCookies.header() },
    redirect: "manual",
  });
  idCookies.applyFrom(loginRes);
  logStep("trumfid/login", loginRes, idCookies);

  const stepParams = new URLSearchParams({ correlationId, returnUrl });

  const validateRes = await fetch(`${ID_BASE}/trumfid/login/validateUser?${stepParams.toString()}`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json", Cookie: idCookies.header() },
    body: JSON.stringify({ phoneNumber }),
  });
  idCookies.applyFrom(validateRes);
  logStep("trumfid/login/validateUser", validateRes, idCookies);
  if (!validateRes.ok) {
    throw new Error(`Trumf: ukjent telefonnummer eller feil ved validering (HTTP ${validateRes.status})`);
  }

  const pwdRes = await fetch(`${ID_BASE}/trumfid/login/pwd?${stepParams.toString()}`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json", Cookie: idCookies.header() },
    body: JSON.stringify({ password, rememberMe: true }),
  });
  idCookies.applyFrom(pwdRes);
  logStep("trumfid/login/pwd", pwdRes, idCookies);
  const pwdBodyText = await pwdRes.text().catch(() => "");
  console.error(`[trumf] pwd body: ${pwdBodyText.slice(0, 300) || "(tom)"}`);
  if (!pwdRes.ok) {
    throw new Error(`Trumf: feil passord (HTTP ${pwdRes.status}): ${pwdBodyText.slice(0, 300)}`);
  }

  const pending: PendingWebLogin = { idCookies, authjsCookies, correlationId, returnUrl };

  // En fersk backend-sesjon har aldri et "husket enhet"-cookie fra før, så
  // Trumf krever alltid SMS-bekreftelse her.
  return { done: false, pending };
}

/** Steg 6-9: fullfør innloggingen med SMS-koden brukeren har mottatt. */
export async function completeWebLoginWithOtp(pending: PendingWebLogin, otp: string): Promise<WebLoginTokens> {
  // Viktig: Trumf sin egen nettside oppdaterer returnUrl til å inneholde
  // acr_values=cas:completed FØR SMS-koden sendes inn (bekreftet fra ekte
  // trafikk) - det er tydeligvis denne verdien som forteller serveren at
  // steg-up-en er fullført når vi senere henter autorisasjonskoden.
  const returnUrlWithStepUp = withAcrValues(pending.returnUrl, "cas:completed");

  const stepParams = new URLSearchParams({
    correlationId: pending.correlationId,
    returnUrl: returnUrlWithStepUp,
  });

  const smsRes = await fetch(`${ID_BASE}/trumfid/smsCode?${stepParams.toString()}`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json", Cookie: pending.idCookies.header() },
    body: JSON.stringify({ otp, rememberMeSms: true }),
  });
  pending.idCookies.applyFrom(smsRes);
  logStep("trumfid/smsCode", smsRes, pending.idCookies);
  const smsBodyText = await smsRes.text().catch(() => "");
  console.error(`[trumf] smsCode body: ${smsBodyText.slice(0, 300) || "(tom)"}`);
  if (!smsRes.ok) {
    throw new Error(`Trumf: feil SMS-kode (HTTP ${smsRes.status})`);
  }

  // Etter vellykket SMS-bekreftelse ber Trumf normalt om å registrere
  // biometrisk pålogging for denne "enheten" (redirect: "/ui/registerbiometric?...").
  // Vi hopper alltid over det - uten dette steget forblir sesjonen i en
  // mellomtilstand og callback-et under gir aldri noen autorisasjonskode.
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
    const skipRes = await fetch(`${ID_BASE}/trumfid/biometri/registration/skip?${skipParams.toString()}`, {
      headers: { ...COMMON_HEADERS, Cookie: pending.idCookies.header() },
      redirect: "manual",
    });
    pending.idCookies.applyFrom(skipRes);
    logStep("trumfid/biometri/registration/skip", skipRes, pending.idCookies);
  }

  const result = await getFinalRedirectLocation(pending, returnUrlWithStepUp);
  if (!result.location) {
    throw new Error(`Trumf: fikk ikke noen autorisasjonskode selv etter SMS-bekreftelse (${result.debug})`);
  }

  // result.location peker nå på www.trumf.no/api/auth/callback/trumf-personal?code=...&state=...
  // - la Auth.js sin egen backend gjøre selve token-byttet (den har client_secret vi ikke har).
  return exchangeViaAuthJs(result.location, pending.authjsCookies);
}

/** Setter/overskriver acr_values i en returnUrl-streng, og gir tilbake en relativ sti+query. */
function withAcrValues(returnUrl: string, acrValues: string): string {
  const url = new URL(returnUrl, ID_BASE);
  url.searchParams.set("acr_values", acrValues);
  return url.pathname + url.search;
}

interface CallbackAttempt {
  /** Fullt Location-mål (typisk www.trumf.no/api/auth/callback/...?code=...&state=...) - null hvis noe feilet. */
  location: string | null;
  /** Menneskelesbar diagnose - fylt ut når location er null, så feilen faktisk kan feilsøkes uten server-tilgang. */
  debug: string;
}

async function getFinalRedirectLocation(pending: PendingWebLogin, returnUrl: string): Promise<CallbackAttempt> {
  const callbackUrl = new URL(returnUrl, ID_BASE);
  callbackUrl.searchParams.set("correlationId", pending.correlationId);

  const res = await fetch(callbackUrl.toString(), {
    headers: { ...COMMON_HEADERS, Cookie: pending.idCookies.header() },
    redirect: "manual",
  });
  pending.idCookies.applyFrom(res);
  logStep("connect/authorize/callback", res, pending.idCookies);

  const location = res.headers.get("location");
  if (!location) {
    const bodySnippet = (await res.text().catch(() => "")).slice(0, 500);
    return { location: null, debug: `HTTP ${res.status} ${res.statusText}, ingen Location-header. Body: ${bodySnippet || "(tom)"}` };
  }

  return { location: new URL(location, ID_BASE).toString(), debug: "" };
}

/**
 * Treffer www.trumf.no sin egen Auth.js-callback (som gjør selve token-byttet
 * server-side med sin client_secret), og henter deretter ut de utstedte
 * tokenene via /api/auth/session.
 */
async function exchangeViaAuthJs(callbackUrl: string, authjsCookies: CookieJar): Promise<WebLoginTokens> {
  const callbackRes = await fetch(callbackUrl, {
    headers: { ...COMMON_HEADERS, Cookie: authjsCookies.header() },
    redirect: "manual",
  });
  authjsCookies.applyFrom(callbackRes);
  logStep("api/auth/callback/" + PROVIDER_ID, callbackRes, authjsCookies);

  if (callbackRes.status >= 400) {
    const bodySnippet = (await callbackRes.text().catch(() => "")).slice(0, 400);
    throw new Error(`Trumf: www.trumf.no sin egen innloggings-callback feilet (HTTP ${callbackRes.status}): ${bodySnippet}`);
  }

  const sessionRes = await fetch(`${AUTHJS_BASE}/api/auth/session`, {
    headers: { ...COMMON_HEADERS, Cookie: authjsCookies.header() },
  });
  authjsCookies.applyFrom(sessionRes);
  const sessionText = await sessionRes.text();
  console.error(`[trumf] api/auth/session -> HTTP ${sessionRes.status}, body: ${sessionText.slice(0, 300) || "(tom)"}`);

  if (!sessionRes.ok) {
    throw new Error(`Trumf: klarte ikke å hente sesjon fra www.trumf.no (HTTP ${sessionRes.status}): ${sessionText.slice(0, 300)}`);
  }

  const session = JSON.parse(sessionText) as { accessToken?: string; idToken?: string };
  if (!session.accessToken) {
    throw new Error(`Trumf: www.trumf.no ga ingen accessToken tilbake - er innloggingen faktisk fullført? Body: ${sessionText.slice(0, 300)}`);
  }

  return {
    accessToken: session.accessToken,
    idToken: session.idToken,
    expiresAt: decodeJwtExpiry(session.accessToken) ?? new Date(Date.now() + 55 * 60 * 1000),
    refreshToken: authjsCookies.header(),
  };
}

/**
 * "Fornyer" en tilkobling - egentlig henter vi bare et ferskt access_token fra
 * www.trumf.no sin egen /api/auth/session med den lagrede cookie-strengen fra
 * forrige innlogging. Ingen ny SMS kreves siden Auth.js sin sesjon varer ~1 år.
 */
export async function refreshWebLogin(storedCookieHeader: string): Promise<WebLoginTokens> {
  const authjsCookies = CookieJar.fromHeader(storedCookieHeader);

  const sessionRes = await fetch(`${AUTHJS_BASE}/api/auth/session`, {
    headers: { ...COMMON_HEADERS, Cookie: authjsCookies.header() },
  });
  authjsCookies.applyFrom(sessionRes);
  const sessionText = await sessionRes.text();
  console.error(`[trumf] refresh api/auth/session -> HTTP ${sessionRes.status}, body: ${sessionText.slice(0, 300) || "(tom)"}`);

  if (!sessionRes.ok) {
    throw new Error(
      `Trumf: fornying feilet (HTTP ${sessionRes.status}) - kontoen må trolig kobles til på nytt: ${sessionText.slice(0, 300)}`
    );
  }

  const session = JSON.parse(sessionText) as { accessToken?: string; idToken?: string };
  if (!session.accessToken) {
    throw new Error(
      `Trumf: www.trumf.no sin sesjon ga ingen accessToken ved fornying - sesjonen er trolig utløpt, kontoen må kobles til på nytt. Body: ${sessionText.slice(0, 300)}`
    );
  }

  return {
    accessToken: session.accessToken,
    idToken: session.idToken,
    expiresAt: decodeJwtExpiry(session.accessToken) ?? new Date(Date.now() + 55 * 60 * 1000),
    refreshToken: authjsCookies.header(),
  };
}
