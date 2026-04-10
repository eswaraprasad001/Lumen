"use client";

import { useState } from "react";

type NewsletterIconProps = {
  domain: string;
  name: string;
  size?: number;
  logoUrl?: string | null;
};

function getInitials(name: string): string {
  // Strip leading emoji / non-letter characters before extracting initials
  const words = name.trim().split(/\s+/).map(w => w.replace(/^[^\p{L}]+/u, "")).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return "?";
}

// Deterministic hue from domain string for consistent fallback colors
function getDomainHue(domain: string): number {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

export function NewsletterIcon({ domain, name, size = 36, logoUrl }: NewsletterIconProps) {
  const [failed, setFailed] = useState(false);

  const imgSrc = logoUrl || (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null);
  const hue = getDomainHue(domain);
  const initials = getInitials(name);

  if (failed || !imgSrc) {
    return (
      <span
        className="newsletter-icon newsletter-icon-fallback"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.38,
          background: `hsl(${hue}, 40%, 78%)`,
          color: `hsl(${hue}, 40%, 28%)`,
        }}
        aria-hidden
      >
        {initials}
      </span>
    );
  }

  return (
    <img
      src={imgSrc!}
      alt=""
      width={size}
      height={size}
      className="newsletter-icon"
      onError={() => setFailed(true)}
      aria-hidden
    />
  );
}
