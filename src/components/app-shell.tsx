import Link from "next/link";
import Image from "next/image";
import { ReactNode, Suspense } from "react";

import { NavLink } from "@/components/nav-link";
import { getShellSummary } from "@/lib/data";
import { isAdmin } from "@/lib/admin";

type AppShellProps = {
  children: ReactNode;
};

const navItems = [
  { href: "/", label: "Home" },
  { href: "/library", label: "Library" },
  { href: "/sources", label: "Sources" },
  { href: "/saved", label: "Saved" },
  { href: "/search", label: "Search" },
  { href: "/settings", label: "Settings" },
];

async function SidebarMeta() {
  const summary = await getShellSummary();

  return (
    <div className="nav-meta">
      <h2>At a glance</h2>
      <p>{summary.status}</p>
      <div className="separator" />
      <p>
        {summary.sourceCount} sources tracked
        <br />
        {summary.savedCount} saved issues
      </p>
    </div>
  );
}

function SidebarMetaFallback() {
  return (
    <div className="nav-meta" style={{ opacity: 0.5 }}>
      <h2>At a glance</h2>
      <p>Loading…</p>
    </div>
  );
}

export async function AppShell({ children }: AppShellProps) {
  const adminUser = await isAdmin();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Link href="/" className="brand-logo-link">
            <Image
              src="/lumen.png"
              alt="Lumen"
              width={52}
              height={52}
              className="brand-logo"
              priority
            />
            <h1>Lumen</h1>
          </Link>
          <p>
            A quiet workspace for newsletters, shaped around return and
            continuity.
          </p>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {navItems.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} />
          ))}
          {adminUser && <NavLink href="/admin" label="Admin" />}
        </nav>

        <Suspense fallback={<SidebarMetaFallback />}>
          <SidebarMeta />
        </Suspense>
      </aside>

      <main className="content">
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
