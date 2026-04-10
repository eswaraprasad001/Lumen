"use client";

import { useState } from "react";
import Link from "next/link";

export function OnboardingModal() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="onboarding-backdrop">
      <div className="onboarding-modal">
        <button
          className="onboarding-close"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          ✕
        </button>

        <div className="onboarding-header">
          <span className="eyebrow">Welcome</span>
          <h2>Your calm reading desk</h2>
          <p>
            Lumen pulls newsletters directly from Gmail — only the
            senders you choose, nothing else. Here&apos;s how to get started
            in three steps.
          </p>
        </div>

        <ol className="onboarding-steps">
          <li className="onboarding-step">
            <span className="onboarding-step-num">1</span>
            <div>
              <strong>Connect Gmail</strong>
              <p>
                Grant read-only access so we can fetch newsletters from your
                inbox. We only ever touch emails from senders you explicitly
                add — nothing else is read.
              </p>
            </div>
          </li>
          <li className="onboarding-step">
            <span className="onboarding-step-num">2</span>
            <div>
              <strong>Add sender rules</strong>
              <p>
                Tell us which email addresses or domains to track — e.g.{" "}
                <em>newsletter@example.com</em> or <em>substack.com</em>. Sync
                only runs against rules you mark as &ldquo;Always include&rdquo;.
              </p>
            </div>
          </li>
          <li className="onboarding-step">
            <span className="onboarding-step-num">3</span>
            <div>
              <strong>Run your first sync</strong>
              <p>
                Hit &ldquo;Sync tracked senders&rdquo; in Settings or use the
                quick sync button on the home page. Your newsletters will appear
                here within seconds.
              </p>
            </div>
          </li>
        </ol>

        <div className="onboarding-footer">
          <Link href="/settings" className="button" onClick={() => setDismissed(true)}>
            Go to Settings to get started
          </Link>
          <button className="button-ghost" onClick={() => setDismissed(true)}>
            I&apos;ll explore on my own
          </button>
        </div>
      </div>
    </div>
  );
}
