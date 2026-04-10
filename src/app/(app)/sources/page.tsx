import Link from "next/link";

import { SourceCard } from "@/components/source-card";
import { SetupState } from "@/components/setup-state";
import { requireAuth } from "@/lib/auth";
import { getSourcesData } from "@/lib/data";

export const dynamic = "force-dynamic";

type SourcesPageProps = {
  searchParams: Promise<{ label?: string }>;
};

export default async function SourcesPage({ searchParams }: SourcesPageProps) {
  await requireAuth();
  const data = await getSourcesData();
  const { label } = await searchParams;

  if (data.mode === "setup") {
    return (
      <>
        <section className="page-header">
          <div>
            <span className="eyebrow">Sources</span>
            <h1>A source-first library, not a time-first feed.</h1>
            <p>
              Browse newsletters by publication and sender. This is where the
              product becomes an archive of relationships rather than just a list
              of arrivals.
            </p>
          </div>
        </section>
        <SetupState page="sources" />
      </>
    );
  }

  // Collect unique labels from sources
  const labelSet = new Set<string>();
  for (const source of data.sources) {
    if (source.ruleLabel) labelSet.add(source.ruleLabel);
  }
  const availableLabels = [...labelSet].sort((a, b) => a.localeCompare(b));

  // Active filter — must be a known label or "all"
  const activeLabel = label && labelSet.has(label) ? label : "all";

  // Group sources by ruleLabel; unlabeled go under null
  const groups = new Map<string | null, typeof data.sources>();
  for (const source of data.sources) {
    const key = source.ruleLabel ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(source);
  }
  const labelled = [...groups.entries()].filter(([k]) => k !== null).sort(([a], [b]) => a!.localeCompare(b!));
  const unlabelled = groups.get(null) ?? [];

  // When a label filter is active, show only that group flat
  const filteredSources = activeLabel !== "all"
    ? data.sources.filter((s) => s.ruleLabel === activeLabel)
    : null;

  return (
    <>
      <section className="page-header">
        <div>
          <span className="eyebrow">Sources</span>
          <h1>A source-first library, not a time-first feed.</h1>
          <p>
            Browse newsletters by publication and sender. This is where the
            product becomes an archive of relationships rather than just a list
            of arrivals.
          </p>
        </div>
      </section>

      {availableLabels.length > 0 && (
        <div className="filter-bar">
          <Link
            href="/sources"
            className={`filter-chip${activeLabel === "all" ? " filter-chip-active" : ""}`}
          >
            All
          </Link>
          {availableLabels.map((lbl) => (
            <Link
              key={lbl}
              href={`/sources?label=${encodeURIComponent(lbl)}`}
              className={`filter-chip${activeLabel === lbl ? " filter-chip-active" : ""}`}
            >
              {lbl}
            </Link>
          ))}
        </div>
      )}

      <section className="grid two">
        {(filteredSources ?? [
          ...labelled.flatMap(([, sources]) => sources),
          ...unlabelled,
        ]).map((source) => <SourceCard key={source.id} source={source} />)}
        {!filteredSources && data.pendingRules.map((rule) => (
          <article key={rule.id} className="source-card source-card-pending">
            <div className="source-header">
              <div>
                <span className="muted-note">{rule.ruleType === "sender_domain" ? "Domain rule" : "Email rule"}</span>
                <h2 style={{ marginTop: "8px" }}>{rule.value}</h2>
              </div>
            </div>
            <p style={{ marginTop: "12px" }} className="muted-note">
              Added as a tracked sender. Sync to pull newsletters from this address.
            </p>
            <div className="source-stats">
              <span className="badge badge-pending">Pending sync</span>
              {rule.sourceLabel ? <span className="badge badge-muted">{rule.sourceLabel}</span> : null}
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
