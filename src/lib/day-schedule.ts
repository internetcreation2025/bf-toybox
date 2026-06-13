// Turns a day's calendar events into the Decider's schedule slots, covering the
// whole day: a morning-at-home block, the timed events in order, and any all-day
// events as context. Gaps and the overnight are handled by the Decider via the
// whole-day defaults (no entry = home; asleep & barefoot ~11pm–7am).

export type DayEvent = {
  summary: string;
  location: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
};

export type DaySlot = { label: string; activity: string; location: string };

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function buildDaySchedule(events: DayEvent[]): DaySlot[] {
  const slots: DaySlot[] = [
    {
      label: "7–9am",
      activity: "Up and pottering at home (kitchen, on the laptop)",
      location: "Home",
    },
  ];

  const timed = [...events]
    .filter((e) => !e.allDay && e.startIso)
    .sort((a, b) => (a.startIso < b.startIso ? -1 : 1));
  for (const e of timed) {
    slots.push({
      label: e.endIso ? `${fmtTime(e.startIso)}–${fmtTime(e.endIso)}` : fmtTime(e.startIso),
      activity: e.summary,
      location: e.location || "",
    });
  }

  for (const e of events.filter((x) => x.allDay)) {
    slots.push({ label: "All day", activity: e.summary, location: e.location || "" });
  }

  return slots;
}
