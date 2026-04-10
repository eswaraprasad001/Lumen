"use client";

import { useCallback, useRef, useState } from "react";

import { NewsletterCard } from "@/components/newsletter-card";
import { MessageRecord } from "@/lib/types";

export function SearchForm() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MessageRecord[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        setResults(data.messages ?? []);
        setSearched(true);
      }
    } catch {
      // aborted — ignore
    } finally {
      setLoading(false);
    }
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void runSearch(query);
  }

  return (
    <>
      <section className="search-panel">
        <form className="search-form" onSubmit={handleSubmit}>
          <label htmlFor="q" className="sr-only">
            Search newsletters
          </label>
          <input
            className="input"
            id="q"
            name="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Try sender names, subjects, themes, or memorable phrases"
            autoFocus
          />
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </form>
      </section>

      <section className="section-card" style={{ marginTop: "18px" }}>
        <header>
          <div>
            <h2>{searched ? `Results for "${query.trim()}"` : "Search results"}</h2>
            <p>
              {searched
                ? `${results.length} matches found in the current archive.`
                : "Enter a query to search across newsletter messages."}
            </p>
          </div>
        </header>

        <div className="stack">
          {searched ? (
            results.length > 0 ? (
              results.map((message) => (
                <NewsletterCard key={message.id} message={message} />
              ))
            ) : (
              <div className="empty-card">
                <p>No matches yet. Search checks sender, subject, snippet, and readable text when available.</p>
              </div>
            )
          ) : (
            <div className="empty-card">
              <p>Search is ready once you have synced newsletters or loaded the demo dataset.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
