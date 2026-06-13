// Server-side calendar read, using an access token minted from the stored
// refresh token. Mirrors the shape of the old client-side reader.
export type GcalEvent = {
  summary: string;
  location: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
};

// Reads events between two RFC3339 timestamps from the primary calendar.
export async function listEvents(
  accessToken: string,
  timeMinIso: string,
  timeMaxIso: string
): Promise<GcalEvent[]> {
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
    `?timeMin=${encodeURIComponent(timeMinIso)}` +
    `&timeMax=${encodeURIComponent(timeMaxIso)}` +
    `&singleEvents=true&orderBy=startTime&maxResults=30`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Calendar read failed (${res.status})`);
  }
  const json = (await res.json()) as {
    items?: Array<{
      summary?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  };
  return (json.items ?? []).map((e) => {
    const allDay = !e.start?.dateTime;
    return {
      summary: e.summary ?? "(no title)",
      location: e.location ?? "",
      startIso: e.start?.dateTime ?? `${e.start?.date}T00:00:00`,
      endIso: e.end?.dateTime ?? e.end?.date ?? e.start?.dateTime ?? "",
      allDay,
    };
  });
}
