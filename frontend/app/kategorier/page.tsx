"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Category, listCategories } from "@/lib/api";

export default function KategorierPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="container">
      <div style={{ padding: "48px 0 24px" }}>
        <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>Bla i kategorier</h1>
        <p className="helper-text">Utforsk produktkatalogen uten å søke - velg en kategori for å se produktene i den.</p>
      </div>

      {loading && <p className="empty-state">Laster kategorier …</p>}

      {!loading && categories.length === 0 && (
        <p className="empty-state">
          Ingen kategoriserte produkter ennå. Datagrunnlaget bygges opp etter hvert som flere kobler
          til kontoen sin – <Link href="/connect">bli med du også</Link>.
        </p>
      )}

      {categories.length > 0 && (
        <div className="category-grid">
          {categories.map((c) => (
            <Link key={c.category} href={`/kategorier/${encodeURIComponent(c.category)}`} className="card category-card">
              <div className="name">{c.category}</div>
              <div className="meta">
                {c.count} {c.count === 1 ? "produkt" : "produkter"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
