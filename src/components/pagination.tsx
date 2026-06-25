import Link from "next/link";

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

type PaginationProps = {
  currentPage: number;
  totalPages: number;
  buildHref: (page: number) => string;
  label?: string;
};

export function Pagination({ currentPage, totalPages, buildHref, label = "Pages" }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav className="pagination-bar" aria-label={label}>
      {currentPage > 1 ? (
        <Link href={buildHref(currentPage - 1)} className="pagination-arrow">
          ← Previous
        </Link>
      ) : (
        <span className="pagination-arrow pagination-arrow-disabled">← Previous</span>
      )}

      <div className="pagination-pages">
        {buildPageNumbers(currentPage, totalPages).map((p, i) =>
          p === "ellipsis" ? (
            <span key={`ellipsis-${i}`} className="pagination-ellipsis">
              …
            </span>
          ) : p === currentPage ? (
            <span key={p} className="pagination-page pagination-page-active" aria-current="page">
              {p}
            </span>
          ) : (
            <Link key={p} href={buildHref(p)} className="pagination-page">
              {p}
            </Link>
          ),
        )}
      </div>

      {currentPage < totalPages ? (
        <Link href={buildHref(currentPage + 1)} className="pagination-arrow">
          Next →
        </Link>
      ) : (
        <span className="pagination-arrow pagination-arrow-disabled">Next →</span>
      )}
    </nav>
  );
}
