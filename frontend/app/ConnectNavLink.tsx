"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getToken, onAuthChange } from "@/lib/auth";

/**
 * Viser "Koble til konto" i toppmenyen kun for brukere som ikke allerede er
 * logget inn. Klient-komponent siden innloggingsstatus kun finnes i
 * localStorage - starter som innlogget=false (samme som server-rendringen)
 * for å unngå hydrerings-mismatch, og korrigeres rett etter mount. Lytter i
 * tillegg på authchange (se lib/auth.ts) siden root-layouten ikke remountes
 * ved client-side navigasjon - uten dette ville en innlogging som skjer uten
 * sidebytte (f.eks. steg-bytte på /connect) aldri blitt fanget opp.
 */
export default function ConnectNavLink() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => onAuthChange(() => setLoggedIn(Boolean(getToken()))), []);

  if (loggedIn) return null;

  return (
    <Link href="/connect" className="nav-link">
      Koble til konto
    </Link>
  );
}
