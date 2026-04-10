"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MouseEvent, useTransition } from "react";

type NavLinkProps = {
  href: string;
  label: string;
};

export function NavLink({ href, label }: NavLinkProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isActive =
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <Link
      href={href}
      className={`nav-item${isActive ? " is-active" : ""}`}
      aria-current={isActive ? "page" : undefined}
      onClick={handleClick}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
        {label}
        {isPending ? <span className="mini-spinner" aria-hidden /> : <span className="mini-spinner-placeholder" aria-hidden />}
      </span>
    </Link>
  );
}
