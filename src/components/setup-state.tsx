import Link from "next/link";

type SetupStateProps = {
  page: "home" | "library" | "sources" | "saved" | "search" | "reader";
};

const messages: Record<SetupStateProps["page"], { heading: string; body: string }> = {
  home: {
    heading: "Your reading desk is almost ready.",
    body: "Connect your Gmail account and add sender rules in Settings to begin collecting newsletters in a calm, dedicated space.",
  },
  library: {
    heading: "Your archive will grow here once newsletters begin arriving.",
    body: "After connecting Gmail and syncing tracked senders, every newsletter issue will be kept searchable and organized here.",
  },
  sources: {
    heading: "Sources will appear once you connect a mailbox and track senders.",
    body: "Each publication you follow gets its own archive page — a quieter replacement for scrolling your inbox.",
  },
  saved: {
    heading: "Nothing saved yet — and that\u2019s perfectly fine.",
    body: "When you find a newsletter worth returning to, save it here. There\u2019s no pressure to finish anything.",
  },
  search: {
    heading: "Search will become available once your first newsletters arrive.",
    body: "You\u2019ll be able to find issues by sender, subject, or any phrase you remember.",
  },
  reader: {
    heading: "This newsletter isn\u2019t available yet.",
    body: "Connect Gmail and sync your tracked senders to start reading newsletters here.",
  },
};

export function SetupState({ page }: SetupStateProps) {
  const content = messages[page];

  return (
    <section className="setup-state">
      <div className="setup-state-icon">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="24" cy="24" r="22" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.4" />
          <path
            d="M16 22l6 6 10-12"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.35"
          />
        </svg>
      </div>
      <h2>{content.heading}</h2>
      <p>{content.body}</p>
      <Link href="/settings" className="button-secondary" style={{ marginTop: "16px" }}>
        Go to Settings
      </Link>
    </section>
  );
}
