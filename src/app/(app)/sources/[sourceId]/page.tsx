import { notFound } from "next/navigation";

import { NewsletterCard } from "@/components/newsletter-card";
import { requireAuth } from "@/lib/auth";
import { getSourceData } from "@/lib/data";

type SourcePageProps = {
  params: Promise<{ sourceId: string }>;
};

export default async function SourcePage({ params }: SourcePageProps) {
  await requireAuth();
  const { sourceId } = await params;
  const data = await getSourceData(sourceId);

  if (!data) {
    notFound();
  }

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
            <p>{data.messages.length} issues from this source.</p>
          </div>
        </header>
        <div className="stack">
          {data.messages.map((message) => (
            <NewsletterCard key={message.id} message={message} />
          ))}
        </div>
      </section>
    </>
  );
}
