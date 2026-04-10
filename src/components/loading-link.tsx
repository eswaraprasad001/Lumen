"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MouseEvent, ReactNode, useTransition } from "react";

type LoadingLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  showSpinner?: boolean;
  reserveSpace?: boolean;
};

export function LoadingLink({ href, children, className, ariaLabel, showSpinner = true, reserveSpace = true }: LoadingLinkProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <Link href={href} className={className} aria-label={ariaLabel} onClick={handleClick}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
        {children}
        {showSpinner ? (
          isPending ? (
            <span className="mini-spinner" aria-hidden />
          ) : reserveSpace ? (
            <span className="mini-spinner-placeholder" aria-hidden />
          ) : null
        ) : null}
      </span>
    </Link>
  );
}
