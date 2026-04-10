export default function Loading() {
  return (
    <>
      <section className="page-header" style={{ marginBottom: "16px" }}>
        <div>
          <span className="eyebrow" style={{ opacity: 0.5 }}>Loading…</span>
        </div>
      </section>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="section-card"
            style={{
              height: "120px",
              opacity: 0.4,
              animation: "pulse 1.5s ease-in-out infinite",
              animationDelay: `${i * 150}ms`,
            }}
          />
        ))}
      </div>
    </>
  );
}
