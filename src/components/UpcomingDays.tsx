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

const DAYS_AHEAD = 3;

// Read-only glance at the next few days, pulled live from the server's offline
// calendar connection — no import step. Prompts to connect if not yet linked.
export function UpcomingDays() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "disconnected" }
    | { kind: "ready"; events: Ev[] }
    | { kind: "error" }
  >({ kind: "loading" });

  useEffect(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + DAYS_AHEAD - 1);
    end.setHours(23, 59, 59, 0);
    const timeMin = start.toISOString();
    const timeMax = end.toISOString();
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
        Next 3 days
      </h2>

      {state.kind === "disconnected" && (
        <Link
          href="/settings"
          className="mt-3 flex items-center justify-between rounded-xl border border-neutral-200 p-4 text-sm transition-colors hover:border-neutral-400 dark:border-neutral-800"
        >
          <span className="text-neutral-500">
            Connect your Google Calendar so the Decider can see your days.
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

      {state.kind === "ready" && (
        <div className="mt-3 space-y-5">
          {buildDays(state.events).map((day) => (
            <div key={day.key}>
              <p className="text-xs font-semibold text-neutral-500">
                {day.label}
              </p>
              {day.events.length === 0 ? (
                <p className="mt-1.5 text-sm text-neutral-400">
                  Nothing on — home.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-2">
                  {day.events.map((e, i) => (
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
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function buildDays(events: Ev[]): Array<{ key: string; label: string; events: Ev[] }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: Array<{ key: string; label: string; events: Ev[] }> = [];
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const key = localDateKey(d);
    const label =
      i === 0
        ? "Today"
        : i === 1
        ? "Tomorrow"
        : d.toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
          });
    days.push({ key, label, events: [] });
  }
  for (const e of events) {
    const key = localDateKey(new Date(e.startIso));
    const bucket = days.find((x) => x.key === key);
    if (bucket) bucket.events.push(e);
  }
  return days;
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
