import Link from "next/link";

import { NewsletterCard } from "@/components/newsletter-card";
import { OnboardingModal } from "@/components/onboarding-modal";
import { QuickSyncButton } from "@/components/quick-sync-button";
import { SetupState } from "@/components/setup-state";
import { requireAuth } from "@/lib/auth";
import { getHomeData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAuth();
  const data = await getHomeData();

  if (data.mode === "setup") {
    return (
      <>
        <section className="page-header">
          <div>
            <span className="eyebrow">Calm reading desk</span>
          </div>
        </section>
        <SetupState page="home" />
      </>
    );
  }

  return (
    <>
      {data.isNewUser ? <OnboardingModal /> : null}
      <section className="page-header" style={{ marginBottom: "16px" }}>
        <div>
          <span className="eyebrow">Calm reading desk</span>
        </div>
        <QuickSyncButton />
      </section>

      <section className="hero-panel">
        <div>
          <span className="eyebrow">Today&apos;s view</span>
          <h1 style={{ marginTop: "12px", fontFamily: "var(--font-serif)", fontSize: "2rem", letterSpacing: "-0.04em", lineHeight: 1.15 }}>
            Newsletters, arranged for return.
          </h1>
          <p style={{ marginTop: "16px", color: "var(--text-soft)", lineHeight: 1.6 }}>
            A quiet overview of what arrived, what you opened, and what you saved.
          </p>
        </div>

        <div className="hero-stat-grid">
          <div className="hero-stat">
            <span>New</span>
            <strong>{data.newItemsTotal}</strong>
          </div>
          <div className="hero-stat">
            <span>Reading</span>
            <strong>{data.continueReading.length}</strong>
          </div>
          <div className="hero-stat">
            <span>Saved</span>
            <strong>{data.savedItems.length}</strong>
          </div>
        </div>
      </section>

      <div className="grid two">
        <section className="section-card">
          <header>
            <div>
              <h2>New arrivals</h2>
            </div>
          </header>
          <div className="stack">
            {data.newItems.length > 0 ? (
              data.newItems.map((message) => (
                <NewsletterCard key={message.id} message={message} />
              ))
            ) : (
              <div className="empty-card">
                <p>No new arrivals.</p>
              </div>
            )}
          </div>
          {data.newItemsTotal > 6 && (
            <div className="section-footer">
              <Link href="/library?filter=new" className="section-footer-link">
                View all {data.newItemsTotal} new issues →
              </Link>
            </div>
          )}
        </section>

        <section className="section-card">
          <header>
            <div>
              <h2>Continue reading</h2>
            </div>
          </header>
          <div className="stack">
            {data.continueReading.length > 0 ? (
              data.continueReading.map((message) => (
                <NewsletterCard key={message.id} message={message} />
              ))
            ) : (
              <div className="empty-card">
                <p>Start reading an issue to track progress.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="grid two" style={{ marginTop: "18px" }}>
        <section className="section-card">
          <header>
            <div>
              <h2>Recently read</h2>
            </div>
          </header>
          <div className="stack">
            {data.recentlyRead.length > 0 ? (
              data.recentlyRead.map((message) => (
                <NewsletterCard key={message.id} message={message} />
              ))
            ) : (
              <div className="empty-card">
                <p>Nothing read recently.</p>
              </div>
            )}
          </div>
        </section>

        <section className="section-card">
          <header>
            <div>
              <h2>Saved for later</h2>
            </div>
          </header>
          <div className="stack">
            {data.savedItems.length > 0 ? (
              data.savedItems.map((message) => (
                <NewsletterCard key={message.id} message={message} />
              ))
            ) : (
              <div className="empty-card">
                <p>No saved issues.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
