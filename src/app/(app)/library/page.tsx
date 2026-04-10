import Link from "next/link";

import { NewsletterCard } from "@/components/newsletter-card";
import { SetupState } from "@/components/setup-state";
import { requireAuth } from "@/lib/auth";
import { getLibraryData } from "@/lib/data";
import { MessageRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type LibraryPageProps = {
  searchParams: Promise<{ filter?: string; page?: string }>;
};

const FILTERS = [
  { value: "all",          label: "All" },
  { value: "new",          label: "New arrivals" },
  { value: "reading",      label: "Reading" },
  { value: "recently_read", label: "Recently read" },
  { value: "saved",        label: "Saved" },
] as const;

type FilterValue = (typeof FILTERS)[number]["value"];

function applyFilter(messages: MessageRecord[], filter: FilterValue): MessageRecord[] {
  switch (filter) {
    case "new":
      return messages.filter((m) => m.state === "new");
    case "reading":
      return messages.filter((m) => m.state === "in_progress" || m.state === "opened");
    case "recently_read":
      return messages.filter((m) => m.state === "finished");
    case "saved":
      return messages.filter((m) => m.saved || m.state === "saved");
    default:
      return messages;
  }
}

function buildPageHref(activeFilter: FilterValue, page: number) {
  const params = new URLSearchParams();
  if (activeFilter !== "all") params.set("filter", activeFilter);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/library?${qs}` : "/library";
}

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  await requireAuth();
  const { filter, page } = await searchParams;
  const validValues = new Set(FILTERS.map((f) => f.value));
  const activeFilter: FilterValue = validValues.has(filter as FilterValue)
    ? (filter as FilterValue)
    : "all";

  const currentPage = Math.max(1, parseInt(page || "1", 10) || 1);

  const data = await getLibraryData();
  const allFiltered = applyFilter(data.messages, activeFilter);
  const totalPages = Math.max(1, Math.ceil(allFiltered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const messages = allFiltered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const activeLabel = FILTERS.find((f) => f.value === activeFilter)?.label ?? "All";

  return (
    <>
      <section className="page-header">
        <div>
          <span className="eyebrow">Library</span>
          <h1>All newsletters, kept searchable and calm.</h1>
          <p>
            The library keeps a long view of your reading without turning it
            into a stream. Search and source filters matter more here than time
            urgency.
          </p>
        </div>
      </section>

      {data.mode === "setup" ? (
        <SetupState page="library" />
      ) : (
        <section className="section-card">
          <header>
            <div>
              <h2>{activeFilter === "all" ? "All issues" : activeLabel}</h2>
              <p>
                {allFiltered.length} issue{allFiltered.length === 1 ? "" : "s"}
                {activeFilter !== "all" ? " matching filter" : " in your library"}.
              </p>
            </div>
          </header>

          <div className="filter-bar">
            {FILTERS.map((f) => (
              <Link
                key={f.value}
                href={f.value === "all" ? "/library" : `/library?filter=${f.value}`}
                className={`filter-chip${activeFilter === f.value ? " filter-chip-active" : ""}`}
              >
                {f.label}
              </Link>
            ))}
          </div>

          <div className="stack">
            {messages.length > 0 ? (
              messages.map((message) => (
                <NewsletterCard key={message.id} message={message} showDelete />
              ))
            ) : (
              <div className="empty-card">
                <p>No issues match this filter.</p>
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <div className="pagination-bar">
              {safePage > 1 ? (
                <Link href={buildPageHref(activeFilter, safePage - 1)} className="button-secondary">
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="pagination-info">
                Page {safePage} of {totalPages}
              </span>
              {safePage < totalPages ? (
                <Link href={buildPageHref(activeFilter, safePage + 1)} className="button-secondary">
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}
