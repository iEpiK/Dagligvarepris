# Dagligvarepris – pris og historikk for norske dagligvarer

En nettside som viser pris og prishistorikk for dagligvarer på tvers av norske
kjeder, bygget på kjøpshistorikk brukerne selv kobler til (Trumf i første
omgang – dekker Kiwi, Meny, Spar og Joker via NorgesGruppen).

## Hvordan dette faktisk fungerer (viktig å forstå før du drifter dette)

Trumf har ingen offentlig/offisiell API for kjøpshistorikk. Dette prosjektet
bruker to reverse-engineerte, uoffisielle deler av Trumf sin egen infrastruktur:

**1. Innlogging** – OAuth2 Authorization Code + PKCE mot `id.trumf.no`, men
drevet gjennom **www.trumf.no sin egen Auth.js (NextAuth)-installasjon** i
stedet for at vi bygger `/connect/authorize`-kallet selv. Grunnen: `client_id=trumf`
er en konfidensiell OAuth-klient som krever en `client_secret` kun
www.trumf.no sin egen backend har (bekreftet ved at et eget forsøk på å kalle
`POST id.trumf.no/connect/token` selv alltid ga `{"error":"invalid_client"}`,
uansett om `client_id` ble sendt i body eller via HTTP Basic). Ved å starte
flyten fra Auth.js sine egne endepunkter lar vi DERES backend gjøre selve
token-byttet, og henter ut resultatet via deres `/api/auth/session`-endepunkt
etterpå – akkurat slik nettleseren selv gjør det. Kartlagt og verifisert
steg for steg via nettleserens Network-fane (ikke gjettet):

```
GET  www.trumf.no/api/auth/csrf                    -> {csrfToken} + csrf-cookie
POST www.trumf.no/api/auth/signin/trumf-personal    csrfToken=...
     -> redirect til id.trumf.no/connect/authorize (Auth.js sin egen state+PKCE)
GET  id.trumf.no/connect/authorize                  -> redirect med correlationId + returnUrl
POST id.trumf.no/trumfid/login/validateUser          {"phoneNumber": "..."}
POST id.trumf.no/trumfid/login/pwd                   {"password": "...", "rememberMe": true}
POST id.trumf.no/trumfid/smsCode                     {"otp": "...", "rememberMeSms": true}   (2FA)
GET  <returnUrl> (=/connect/authorize/callback)      -> redirect med ?code=...&state=...
     -> redirect videre til www.trumf.no/api/auth/callback/trumf-personal
GET  www.trumf.no/api/auth/callback/trumf-personal   Auth.js bytter koden mot tokens server-side
GET  www.trumf.no/api/auth/session                   -> {"accessToken": "...", "idToken": "...", ...}
```

Full implementasjon: `backend/src/connectors/trumf/webAuth.ts`. Auth.js sin
egen sesjon (cookien vi lagrer kryptert som "refreshToken", selv om det ikke
er et ekte OAuth refresh_token) varer rundt ett år, mens access_token kun
varer 1 time – bakgrunnsjobben kaller derfor `/api/auth/session` på nytt for
hver synk (`refreshWebLogin()` i samme fil) i stedet for å gjøre en ny full
SMS-flyt.

Merk: dette er **web-varianten** av innloggingen (samme som `www.trumf.no`
selv bruker), ikke Android-appens. Det er bevisst – Android-appens flyt
(`client_id=trumf.app`) krever en Google Play Integrity-attestering
(enhets-/app-signaturbevis) som ikke lar seg etterligne fra en backend-tjeneste.
Web-flyten krever ingen slik attestering.

**2. Henting av kvitteringer** – samme endepunkt som Android-appen bruker:

```
GET https://platform-rest-prod.ngdata.no/trumf/husstand/transaksjoner
GET https://platform-rest-prod.ngdata.no/trumf/husstand/transaksjoner/detaljer/{batchid}
```

Kilder som dokumenterer dette (funnet gjennom research, ikke noe jeg har funnet opp):

- https://helgesver.re/articles/reverse-engineering-norwegian-grocery-apps
  (dekker også Rema 1000 og Coop – nyttig for fase 2)
- https://github.com/ttyridal/trumf-data-fetch (viser faktisk request/response-format)
- https://gist.github.com/HelgeSverre/80a7f34f874336324184a0c513c2e6a2

**Det jeg IKKE har bekreftet ennå (test dette først):**

- At `Authorization: Bearer <access_token>` er riktig headerformat mot
  `platform-rest-prod.ngdata.no/trumf/husstand/transaksjoner` når tokenet
  kommer fra web-innloggingen (kun brukt mot `saldo`/medlemsdata i det jeg
  observerte i nettleseren – ikke mot transaksjonshistorikk direkte).
- At scopet vi får (`api.rest api.sylinder api.trumfid ... offline_access
  openid profile`) faktisk gir tilgang til kvitteringshistorikk og ikke bare
  saldo/medlemsdata.

Kjør én ekte `POST /connections/trumf/start` + `/otp` og se om
`syncTrumfConnection` faktisk henter kvitteringer (sjekk `lastError`-feltet på
`ChainConnection` hvis noe feiler) – det er neste steg.

### Juridisk og etisk – vær bevisst på dette

- Dette er **ikke** en offisiell integrasjon. Trumf/NorgesGruppen sine
  brukervilkår tillater sannsynligvis ikke automatisert henting av data via
  interne API-er. Endepunktene kan endres eller blokkeres uten varsel.
- Vi håndterer andre menneskers kjøpshistorikk, som er personopplysninger.
  Innhent eksplisitt samtykke, krypter alt som lagres (se
  `backend/src/utils/crypto.ts`), og gi brukerne mulighet til å koble fra og
  slette sine data.
- Vurder om dette skal være en lukket beta for deg selv/venner i starten,
  fremfor en offentlig tjeneste, nettopp fordi det uoffisielle grunnlaget gjør
  drift i stor skala mer risikabelt.

## Arkitektur

```
Postgres  <──  backend (Express + Prisma, TypeScript)  <──  connectors/trumf
                     │                                        (fase 2: rema, coop)
                     │  REST API
                     ▼
frontend (Next.js)  →  nginx (din server)  →  internett
```

- **users** – kontoer på selve nettsiden din
- **chain_connections** – kryptert token per bruker per kjede (Trumf i dag)
- **receipts / receipt_items** – normalisert kvitteringsdata hentet fra kjeden
- **products** – kanonisk produktkatalog, matchet på EAN-strekkode der mulig
- **prices** – tidsserie: produkt × butikk × pris × tidspunkt (bygget fra kvitteringslinjer)

Se `backend/prisma/schema.prisma` for fullt skjema.

## Kjøre lokalt / på din server

```bash
cp .env.example .env
# fyll inn ENCRYPTION_KEY (32 bytes, base64) og JWT_SECRET, se kommentarer i filen
docker compose up -d --build
```

Backend lytter på `:4000`, frontend på `:3000`, Postgres internt på `:5432`.
Bruk `nginx/grocery.conf` som utgangspunkt for reverse proxy på din
eksisterende nginx-instans (bytt ut `dagligvarepris.example.no`).

Kjør migreringer:

```bash
docker compose exec backend npx prisma migrate deploy
```

## Status / hva som mangler før dette er en ferdig tjeneste

- [x] Trumf-innlogging (web-flyten, OAuth2 + PKCE + SMS) – implementert i
      `backend/src/connectors/trumf/webAuth.ts`, kartlagt fra ekte trafikk
- [ ] Verifisere at kvitteringshentingen (`fetchReceipts`) faktisk fungerer
      med et web-utstedt token (se avsnittet over) – gjør en ekte test-tilkobling
- [ ] Rema 1000- og Coop-connectors (endepunkter er dokumentert i kildene over,
      samme mønster som Trumf-connectoren)
- [ ] Bedre produktmatching på tvers av kjeder når EAN mangler (fuzzy matching)
- [ ] E-postbekreftelse / passordreset for brukerkontoer
- [ ] Rate-limiting og overvåkning av om Trumf-endepunktet endrer seg
- [ ] Personvernerklæring og "slett kontoen min"-flyt i UI (backend-endepunkt
      for disconnect finnes allerede, se `routes/connections.ts`)
- [ ] Flytte `pendingLogins.ts` sin in-memory lagring til Redis e.l. dersom du
      noen gang kjører flere enn én backend-instans
