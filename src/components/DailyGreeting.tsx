"use client";

import { useEffect, useState } from "react";

// Shown at the top of Home when the user arrives via a morning or evening push
// notification (/?greet=morning or /?greet=evening). Fetches her message from
// /api/rhythm and shows it in a tasteful, dismissible panel.
export function DailyGreeting() {
  const [part, setPart] = useState<"morning" | "evening" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const greet = new URLSearchParams(window.location.search).get("greet");
    if (greet === "morning" || greet === "evening") {
      setPart(greet);
    }
  }, []);

  useEffect(() => {
    if (!part) return;
    setLoading(true);
    fetch(`/api/rhythm?part=${part}`)
      .then(async (res) => {
        const text = await res.text();
        let json: { message?: string; error?: string } = {};
        try {
          json = JSON.parse(text);
        } catch {
          // empty or unparseable body — treat as no message
        }
        if (json.message) setMessage(json.message);
      })
      .catch(() => {
        // network error — fail silently, no panel
      })
      .finally(() => setLoading(false));
  }, [part]);

  if (!part || dismissed) return null;

  return (
    <div className="relative mt-6 rounded-2xl border border-line bg-surface p-5">
      {/* dismiss button */}
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="absolute right-4 top-4 text-muted transition-colors hover:text-foreground"
      >
        ×
      </button>

      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {part === "morning" ? "Good morning" : "End of day"}
      </p>

      {loading ? (
        <div className="mt-3 flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:150ms]" />
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:300ms]" />
        </div>
      ) : message ? (
        <p className="mt-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-200">
          {message}
        </p>
      ) : null}
    </div>
  );
}
