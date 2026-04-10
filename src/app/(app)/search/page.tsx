import { requireAuth } from "@/lib/auth";
import { SearchForm } from "@/components/search-form";

export default async function SearchPage() {
  await requireAuth();

  return (
    <>
      <section className="page-header">
        <div>
          <span className="eyebrow">Search</span>
          <h1>Find by sender, subject, or remembered phrase.</h1>
          <p>
            Search is meant to be a calm retrieval layer across your newsletter
            archive, not a time-bound queue.
          </p>
        </div>
      </section>

      <SearchForm />
    </>
  );
}
