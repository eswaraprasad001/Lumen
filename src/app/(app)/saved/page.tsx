import Link from "next/link";

import { NewsletterCard } from "@/components/newsletter-card";
import { SetupState } from "@/components/setup-state";
import { requireAuth } from "@/lib/auth";
import { getSavedData } from "@/lib/data";

export const dynamic = "force-dynamic";

type SavedPageProps = {
  searchParams: Promise<{ folder?: string }>;
};

export default async function SavedPage({ searchParams }: SavedPageProps) {
  await requireAuth();
  const { folder } = await searchParams;
  const data = await getSavedData(folder ?? null);

  const activeFolder = folder
    ? data.folders.find((f) => f.id === folder) ?? null
    : null;

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
              <h2>{activeFolder ? activeFolder.name : "Saved issues"}</h2>
              <p>
                {data.totalCount} newsletter{data.totalCount === 1 ? "" : "s"} kept in view.
              </p>
            </div>
          </header>

          {data.folders.length > 0 && (
            <div className="filter-bar">
              <Link
                href="/saved"
                className={`filter-chip${!folder ? " filter-chip-active" : ""}`}
              >
                All
              </Link>
              {data.folders.map((f) => (
                <Link
                  key={f.id}
                  href={`/saved?folder=${f.id}`}
                  className={`filter-chip${folder === f.id ? " filter-chip-active" : ""}`}
                >
                  {f.name}
                  {f.messageCount > 0 && (
                    <span className="filter-chip-count">{f.messageCount}</span>
                  )}
                </Link>
              ))}
            </div>
          )}

          <div className="stack">
            {data.messages.length > 0 ? (
              data.messages.map((message) => (
                <NewsletterCard key={message.id} message={message} />
              ))
            ) : (
              <div className="empty-card">
                <p>
                  {activeFolder
                    ? `No saved issues in "${activeFolder.name}" yet.`
                    : "Save a newsletter issue when you want it to remain visible without pressure."}
                </p>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
