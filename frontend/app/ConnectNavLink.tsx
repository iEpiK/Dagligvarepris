"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Viser "Koble til konto" i toppmenyen kun for brukere som ikke allerede er
 * logget inn. Klient-komponent siden innloggingsstatus kun finnes i
 * localStorage - starter som innlogget=false (samme som server-rendringen)
 * for å unngå hydrerings-mismatch, og korrigeres rett etter mount.
 */
export default function ConnectNavLink() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(Boolean(localStorage.getItem("token")));
  }, []);

  if (loggedIn) return null;

  return (
    <Link href="/connect" className="nav-link">
      Koble til konto
    </Link>
  );
}
