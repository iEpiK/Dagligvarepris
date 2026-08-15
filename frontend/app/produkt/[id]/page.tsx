import { getPriceHistory, getProduct } from "@/lib/api";
import PriceChart from "@/components/PriceChart";

export default async function ProductPage({ params }: { params: { id: string } }) {
  const [detail, history] = await Promise.all([
    getProduct(params.id),
    getPriceHistory(params.id),
  ]);

  if (!detail) {
    return (
      <main className="container">
        <p className="empty-state">Fant ikke produktet.</p>
      </main>
    );
  }

  const { product, latestByChain } = detail;

  return (
    <main className="container">
      <div style={{ padding: "40px 0 8px" }}>
        <h1 style={{ margin: 0, fontSize: 26 }}>{product.name}</h1>
        {product.category && <p className="helper-text">{product.category}</p>}
      </div>

      <div className="section-title">Nåværende priser</div>
      <div className="product-list">
        {latestByChain.length === 0 && (
          <p className="helper-text">Ingen priser registrert ennå for dette produktet.</p>
        )}
        {latestByChain.map((p: any) => (
          <div key={p.chain} className="card product-row">
            <div>
              <div className="name" style={{ textTransform: "capitalize" }}>
                {p.store?.name ?? p.chain}
              </div>
              <div className="meta">
                Sist registrert {new Date(p.observedAt).toLocaleDateString("nb-NO")}
              </div>
            </div>
            <span className="price-pill">{Number(p.price).toFixed(2)} kr</span>
          </div>
        ))}
      </div>

      <div className="section-title">Prishistorikk</div>
      <div className="card">
        <PriceChart data={history} />
      </div>
    </main>
  );
}
