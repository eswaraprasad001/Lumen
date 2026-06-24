import Link from "next/link";

import { NewsletterCard } from "@/components/newsletter-card";
import { SetupState } from "@/components/setup-state";
import { requireAuth } from "@/lib/auth";
import { getLibraryData } from "@/lib/data";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type LibraryPageProps = {
  searchParams: Promise<{ filter?: string; page?: string }>;
};

const FILTERS = [
  { value: "all",           label: "All" },
  { value: "new",           label: "New arrivals" },
  { value: "reading",       label: "Reading" },
  { value: "recently_read", label: "Recently read" },
  { value: "saved",         label: "Saved" },
] as const;

type FilterValue = (typeof FILTERS)[number]["value"];

function buildPageHref(activeFilter: FilterValue, page: number) {
  const params = new URLSearchParams();
  if (activeFilter !== "all") params.set("filter", activeFilter);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/library?${qs}` : "/library";
}

// Always show first/last page plus a window around the current page, collapsing gaps into an ellipsis.
function buildPageNumbers(current: number, total: number): (number | "ellipsis")[] {
  const pages: (number | "ellipsis")[] = [1];
  const siblings = 1;

  if (current - siblings > 2) pages.push("ellipsis");
  for (let p = Math.max(2, current - siblings); p <= Math.min(total - 1, current + siblings); p++) {
    pages.push(p);
  }
  if (current + siblings < total - 1) pages.push("ellipsis");
  if (total > 1) pages.push(total);

  return pages;
}

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  await requireAuth();
  const { filter, page } = await searchParams;
  const validValues = new Set(FILTERS.map((f) => f.value));
  const activeFilter: FilterValue = validValues.has(filter as FilterValue)
    ? (filter as FilterValue)
    : "all";

  const currentPage = Math.max(1, parseInt(page || "1", 10) || 1);

  // DB-side filter + pagination — no in-memory slicing
  const data = await getLibraryData(activeFilter, currentPage);
  const totalCount = data.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const { messages } = data;

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
                {totalCount} issue{totalCount === 1 ? "" : "s"}
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
            <nav className="pagination-bar" aria-label="Library pages">
              {safePage > 1 ? (
                <Link href={buildPageHref(activeFilter, safePage - 1)} className="pagination-arrow">
                  ← Previous
                </Link>
              ) : (
                <span className="pagination-arrow pagination-arrow-disabled">← Previous</span>
              )}

              <div className="pagination-pages">
                {buildPageNumbers(safePage, totalPages).map((p, i) =>
                  p === "ellipsis" ? (
                    <span key={`ellipsis-${i}`} className="pagination-ellipsis">
                      …
                    </span>
                  ) : p === safePage ? (
                    <span key={p} className="pagination-page pagination-page-active" aria-current="page">
                      {p}
                    </span>
                  ) : (
                    <Link key={p} href={buildPageHref(activeFilter, p)} className="pagination-page">
                      {p}
                    </Link>
                  ),
                )}
              </div>

              {safePage < totalPages ? (
                <Link href={buildPageHref(activeFilter, safePage + 1)} className="pagination-arrow">
                  Next →
                </Link>
              ) : (
                <span className="pagination-arrow pagination-arrow-disabled">Next →</span>
              )}
            </nav>
          )}
        </section>
      )}
    </>
  );
}
