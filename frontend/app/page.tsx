"use client";

import { useState } from "react";
import Link from "next/link";
import { Product, searchProducts } from "@/lib/api";

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSearched(true);
    const products = await searchProducts(query);
    setResults(products);
    setLoading(false);
  }

  return (
    <main className="container">
      <section className="hero">
        <h1>Se hvor dagligvarene er billigst</h1>
        <p>
          Prishistorikk for norske dagligvarer, bygget på ekte kjøpsdata fra brukere som har
          koblet til kontoen sin. Ingen manuell registrering – bare koble til én gang.
        </p>
        <form className="search-box" onSubmit={runSearch}>
          <input
            type="text"
            placeholder="Søk etter et produkt, f.eks. «Tine lettmelk»"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit">Søk</button>
        </form>
      </section>

      {loading && <p className="empty-state">Søker …</p>}

      {!loading && searched && results.length === 0 && (
        <p className="empty-state">
          Ingen produkter funnet ennå. Datagrunnlaget bygges opp etter hvert som flere kobler til
          kontoen sin – <Link href="/connect">bli med du også</Link>.
        </p>
      )}

      {results.length > 0 && (
        <div className="product-list">
          {results.map((p) => (
            <Link key={p.id} href={`/produkt/${p.id}`} className="card product-row">
              <div>
                <div className="name">{p.name}</div>
                {p.category && <div className="meta">{p.category}</div>}
              </div>
              <span className="price-pill">Se pris →</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
