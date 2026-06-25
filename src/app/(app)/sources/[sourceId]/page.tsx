import { notFound } from "next/navigation";

import { NewsletterCard } from "@/components/newsletter-card";
import { Pagination } from "@/components/pagination";
import { requireAuth } from "@/lib/auth";
import { getSourceData } from "@/lib/data";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SourcePageProps = {
  params: Promise<{ sourceId: string }>;
  searchParams: Promise<{ page?: string }>;
};

function buildPageHref(sourceId: string, page: number) {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/sources/${sourceId}?${qs}` : `/sources/${sourceId}`;
}

export default async function SourcePage({ params, searchParams }: SourcePageProps) {
  await requireAuth();
  const { sourceId } = await params;
  const { page } = await searchParams;
  const currentPage = Math.max(1, parseInt(page || "1", 10) || 1);
  const data = await getSourceData(sourceId, currentPage);

  if (!data) {
    notFound();
  }

  const totalPages = Math.max(1, Math.ceil(data.totalCount / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);

  return (
    <>
      <section className="page-header">
        <div>
          <span className="eyebrow">Source detail</span>
          <h1>{data.source.displayName}</h1>
          <p>
            {data.source.senderEmail} · {data.source.senderDomain}
            {data.source.category ? ` · ${data.source.category}` : ""}
          </p>
        </div>
      </section>

      <section className="section-card">
        <header>
          <div>
            <h2>Recent issues</h2>
            <p>{data.totalCount} issue{data.totalCount === 1 ? "" : "s"} from this source.</p>
          </div>
        </header>
        <div className="stack">
          {data.messages.map((message) => (
            <NewsletterCard key={message.id} message={message} />
          ))}
        </div>

        <Pagination
          currentPage={safePage}
          totalPages={totalPages}
          buildHref={(p) => buildPageHref(sourceId, p)}
          label="Source pages"
        />
      </section>
    </>
  );
}
