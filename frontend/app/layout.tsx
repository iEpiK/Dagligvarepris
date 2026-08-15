import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dagligvarepris – pris og historikk for norske dagligvarer",
  description:
    "Sammenlign priser og se prishistorikk for dagligvarer på tvers av norske kjeder, bygget på kvitteringsdata brukerne selv velger å dele.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="no">
      <body>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="logo">
              Daglig<span>vare</span>pris
            </Link>
            <Link href="/connect" className="nav-link">
              Koble til konto
            </Link>
          </div>
        </header>
        {children}
        <footer>
          Priser er basert på kvitteringsdata brukere frivillig deler. Uoffisiell tjeneste,
          ikke tilknyttet Trumf, NorgesGruppen eller noen dagligvarekjede.
        </footer>
      </body>
    </html>
  );
}
