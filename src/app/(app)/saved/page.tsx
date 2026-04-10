import { NewsletterCard } from "@/components/newsletter-card";
import { SetupState } from "@/components/setup-state";
import { requireAuth } from "@/lib/auth";
import { getSavedData } from "@/lib/data";

export default async function SavedPage() {
  await requireAuth();
  const data = await getSavedData();

  return (
    <>
      <section className="page-header">
        <div>
          <span className="eyebrow">Saved</span>
          <h1>What you wanted to keep nearby.</h1>
          <p>
            Saved is a softer holding area than a backlog. It is there for
            intentional return, not to measure performance.
          </p>
        </div>
      </section>

      {data.mode === "setup" ? (
        <SetupState page="saved" />
      ) : (
      <section className="section-card">
        <header>
          <div>
            <h2>Saved issues</h2>
            <p>{data.messages.length} newsletters kept in view.</p>
          </div>
        </header>
        <div className="stack">
          {data.messages.length > 0 ? (
            data.messages.map((message) => (
              <NewsletterCard key={message.id} message={message} />
            ))
          ) : (
            <div className="empty-card">
              <p>Save a newsletter issue when you want it to remain visible without pressure.</p>
            </div>
          )}
        </div>
      </section>
      )}
    </>
  );
}
