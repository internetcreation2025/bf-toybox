"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Ev = {
  summary: string;
  location: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
};

// Read-only glance at today's calendar, pulled live from the server's offline
// connection — no import step. Prompts to connect if not yet linked.
export function TodayCalendar() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "disconnected" }
    | { kind: "ready"; events: Ev[] }
    | { kind: "error" }
  >({ kind: "loading" });

  useEffect(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const timeMin = new Date(`${date}T00:00:00`).toISOString();
    const timeMax = new Date(`${date}T23:59:59`).toISOString();
    fetch(`/api/calendar/today?timeMin=${timeMin}&timeMax=${timeMax}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.connected) return setState({ kind: "disconnected" });
        setState({ kind: "ready", events: j.events ?? [] });
      })
      .catch(() => setState({ kind: "error" }));
  }, []);

  if (state.kind === "loading") return null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Today
      </h2>

      {state.kind === "disconnected" && (
        <Link
          href="/settings"
          className="mt-3 flex items-center justify-between rounded-xl border border-neutral-200 p-4 text-sm transition-colors hover:border-neutral-400 dark:border-neutral-800"
        >
          <span className="text-neutral-500">
            Connect your Google Calendar so the Decider can see your day.
          </span>
          <span aria-hidden className="text-neutral-400">
            →
          </span>
        </Link>
      )}

      {state.kind === "error" && (
        <p className="mt-3 text-sm text-neutral-400">
          Couldn&apos;t read your calendar just now.
        </p>
      )}

      {state.kind === "ready" && state.events.length === 0 && (
        <p className="mt-3 text-sm text-neutral-400">
          Nothing on today — home it is.
        </p>
      )}

      {state.kind === "ready" && state.events.length > 0 && (
        <ul className="mt-3 space-y-2">
          {state.events.map((e, i) => (
            <li
              key={i}
              className="flex items-baseline gap-3 rounded-xl border border-neutral-200 p-3 text-sm dark:border-neutral-800"
            >
              <span className="w-24 shrink-0 tabular-nums text-neutral-500">
                {e.allDay ? "All day" : fmtRange(e.startIso, e.endIso)}
              </span>
              <span className="min-w-0">
                <span className="font-medium">{e.summary}</span>
                {e.location && (
                  <span className="text-neutral-400"> · {e.location}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function fmtRange(startIso: string, endIso: string): string {
  const t = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  try {
    return endIso ? `${t(startIso)}–${t(endIso)}` : t(startIso);
  } catch {
    return "";
  }
}
