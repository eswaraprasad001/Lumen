export default function ReaderLoading() {
  return (
    <>
      <section className="page-header" style={{ marginBottom: "18px" }}>
        <div>
          <span className="eyebrow" style={{ opacity: 0.5 }}>Reader</span>
        </div>
      </section>
      <section className="reader-shell">
        <div className="reader-content">
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div
              style={{
                height: "32px",
                width: "60%",
                borderRadius: "8px",
                background: "var(--border)",
                opacity: 0.4,
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                style={{
                  height: "14px",
                  width: i === 7 ? "40%" : "100%",
                  borderRadius: "4px",
                  background: "var(--border)",
                  opacity: 0.3,
                  animation: "pulse 1.5s ease-in-out infinite",
                  animationDelay: `${i * 80}ms`,
                }}
              />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
