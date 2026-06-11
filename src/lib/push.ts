import webpush from "web-push";

// Server-only Web Push helper. VAPID keys identify our server to the browser
// push services. Never import this into client code.
const subject = process.env.VAPID_SUBJECT;
const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;

export const pushConfigured = Boolean(subject && publicKey && privateKey);

// Configure web-push lazily (never at module load). Validating the VAPID keys
// at import time would crash the whole build/route collection if a key is
// missing or malformed — instead, a bad key just makes a send fail cleanly.
let vapidReady = false;
function ensureVapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(subject as string, publicKey as string, privateKey as string);
  vapidReady = true;
}

export type StoredSub = { endpoint: string; p256dh: string; auth: string };

// Deliberately generic — NO verdict, rarity, or any private content ever goes
// in a push payload. It only nudges the owner to open the (auth-gated) app.
export type PushPayload = { title: string; body: string; url: string };

export async function sendPush(sub: StoredSub, payload: PushPayload) {
  if (!pushConfigured) throw new Error("Push is not configured.");
  ensureVapid();
  return webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload)
  );
}
