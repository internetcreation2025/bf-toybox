// Client-side Google Calendar access via Google Identity Services (token model).
// No client secret, no change to the app's Supabase login — the browser asks
// Google for a short-lived access token on demand, scoped to calendar events.
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
};
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
}
interface GoogleNS {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string;
        scope: string;
        callback: (resp: TokenResponse) => void;
      }) => TokenClient;
    };
  };
}

let cached: { token: string; exp: number } | null = null;

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { google?: GoogleNS };
    if (w.google?.accounts?.oauth2) return resolve();
    const existing = document.getElementById("gis-client");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Couldn't load Google."))
      );
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.id = "gis-client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load Google."));
    document.head.appendChild(s);
  });
}

async function getToken(): Promise<string> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "Calendar isn't set up yet — NEXT_PUBLIC_GOOGLE_CLIENT_ID is missing."
    );
  }
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  await loadGis();
  const w = window as unknown as { google?: GoogleNS };
  const oauth2 = w.google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google library didn't load.");

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || "Google declined the request."));
          return;
        }
        cached = {
          token: resp.access_token,
          exp: Date.now() + (resp.expires_in ?? 3600) * 1000,
        };
        resolve(resp.access_token);
      },
    });
    client.requestAccessToken({ prompt: cached ? "" : "consent" });
  });
}

export type GcalEvent = {
  summary: string;
  location: string;
  startIso: string;
  endIso: string;
};

// Reads the events for a single local day (YYYY-MM-DD), timed events only.
export async function listEventsForDay(dateIso: string): Promise<GcalEvent[]> {
  const token = await getToken();
  const timeMin = new Date(`${dateIso}T00:00:00`).toISOString();
  const timeMax = new Date(`${dateIso}T23:59:59`).toISOString();
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
    `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(
      timeMax
    )}&singleEvents=true&orderBy=startTime&maxResults=20`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Couldn't read your calendar.");
  const json = (await res.json()) as {
    items?: Array<{
      summary?: string;
      location?: string;
      start?: { dateTime?: string };
      end?: { dateTime?: string };
    }>;
  };
  return (json.items ?? [])
    .filter((e) => e.start?.dateTime)
    .map((e) => ({
      summary: e.summary ?? "(no title)",
      location: e.location ?? "",
      startIso: e.start!.dateTime!,
      endIso: e.end?.dateTime ?? e.start!.dateTime!,
    }));
}

// Writes a simple all-day event on the given local day.
export async function createAllDayEvent(opts: {
  summary: string;
  description?: string;
  dateIso: string;
}): Promise<void> {
  const token = await getToken();
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: opts.summary,
        description: opts.description ?? "",
        start: { date: opts.dateIso },
        end: { date: opts.dateIso },
      }),
    }
  );
  if (!res.ok) throw new Error("Couldn't add the event to your calendar.");
}
