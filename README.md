# Dagligvarepris – pris og historikk for norske dagligvarer

En nettside som viser pris og prishistorikk for dagligvarer på tvers av norske
kjeder, bygget på kjøpshistorikk brukerne selv kobler til (Trumf i første
omgang – dekker Kiwi, Meny, Spar og Joker via NorgesGruppen).

## Hvordan dette faktisk fungerer (viktig å forstå før du drifter dette)

Trumf har ingen offentlig/offisiell API for kjøpshistorikk. Dette prosjektet
bruker et **reverse-engineert, uoffisielt endepunkt** som Trumf sin egen app
bruker internt:

```
GET https://platform-rest-prod.ngdata.no/trumf/husstand/transaksjoner
GET https://platform-rest-prod.ngdata.no/trumf/husstand/transaksjoner/detaljer/{batchid}
```

Kilder som dokumenterer dette (funnet gjennom research, ikke noe jeg har funnet opp):

- https://helgesver.re/articles/reverse-engineering-norwegian-grocery-apps
  (dekker også Rema 1000 og Coop – nyttig for fase 2)
- https://github.com/ttyridal/trumf-data-fetch (viser faktisk request/response-format)
- https://gist.github.com/HelgeSverre/80a7f34f874336324184a0c513c2e6a2

**Det jeg IKKE har bekreftet endepunktet for:** selve innloggingen (hvordan man
bytter telefonnummer+passord mot en gyldig `Authorization`-token). Dette må
verifiseres manuelt – se `backend/src/connectors/trumf/client.ts` for hvor du
plugger det inn, og fremgangsmåten under.

### Slik finner/verifiserer du innloggings-endepunktet

1. Installer mitmproxy på en maskin, konfigurer telefonen din til å bruke den
   som proxy, installer mitmproxy sitt CA-sertifikat på telefonen.
2. Logg ut og inn igjen i Trumf-appen, se hvilket kall som skjer når du taster
   inn telefonnummer/passord, og hvilket JSON-svar som kommer tilbake
   (sannsynligvis et JWT eller en sesjonstoken).
3. Fyll inn URL, request-body og hvordan tokenet parses i
   `backend/src/connectors/trumf/client.ts` → funksjonen `login()`.

Dette er bevisst ikke gjettet/hardkodet, fordi feil gjetning ville sett ut som
at det virker mens det i realiteten hadde logget feil ting eller lekket noe.

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

- [ ] Verifisere/implementere ekte Trumf-innlogging (se over)
- [ ] Rema 1000- og Coop-connectors (endepunkter er dokumentert i kildene over,
      samme mønster som Trumf-connectoren)
- [ ] Bedre produktmatching på tvers av kjeder når EAN mangler (fuzzy matching)
- [ ] E-postbekreftelse / passordreset for brukerkontoer
- [ ] Rate-limiting og overvåkning av om Trumf-endepunktet endrer seg
- [ ] Personvernerklæring og "slett kontoen min"-flyt i UI (backend-endepunkt
      for disconnect finnes allerede, se `routes/connections.ts`)
