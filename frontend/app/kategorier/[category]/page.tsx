"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Product, listProductsByCategory } from "@/lib/api";

export default function KategoriPage() {
  const params = useParams<{ category: string }>();
  const category = decodeURIComponent(params.category);

  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setLoading(true);
    setProducts([]);
    setPage(1);
    listProductsByCategory(category, 1).then((result) => {
      setProducts(result.products);
      setHasMore(result.hasMore);
      setLoading(false);
    });
  }, [category]);

  async function loadMore() {
    setLoadingMore(true);
    const nextPage = page + 1;
    const result = await listProductsByCategory(category, nextPage);
    setProducts((prev) => [...prev, ...result.products]);
    setHasMore(result.hasMore);
    setPage(nextPage);
    setLoadingMore(false);
  }

  return (
    <main className="container">
      <div style={{ padding: "48px 0 24px" }}>
        <Link href="/kategorier" className="helper-text">
          ← Alle kategorier
        </Link>
        <h1 style={{ fontSize: 26, margin: "8px 0 0" }}>{category}</h1>
      </div>

      {loading && <p className="empty-state">Laster produkter …</p>}

      {!loading && products.length === 0 && <p className="empty-state">Ingen produkter i denne kategorien ennå.</p>}

      {products.length > 0 && (
        <div className="product-list">
          {products.map((p) => (
            <Link key={p.id} href={`/produkt/${p.id}`} className="card product-row">
              <div>
                <div className="name">{p.name}</div>
              </div>
              <span className="price-pill">Se pris →</span>
            </Link>
          ))}
        </div>
      )}

      {hasMore && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button type="button" className="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Laster …" : "Last inn flere"}
          </button>
        </div>
      )}
    </main>
  );
}
