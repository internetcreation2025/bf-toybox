import webpush from "web-push";

// Server-only Web Push helper. VAPID keys identify our server to the browser
// push services. Never import this into client code.
const subject = process.env.VAPID_SUBJECT;
const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;

export const pushConfigured = Boolean(subject && publicKey && privateKey);

if (pushConfigured) {
  webpush.setVapidDetails(subject as string, publicKey as string, privateKey as string);
}

export type StoredSub = { endpoint: string; p256dh: string; auth: string };

// Deliberately generic — NO verdict, rarity, or any private content ever goes
// in a push payload. It only nudges the owner to open the (auth-gated) app.
export type PushPayload = { title: string; body: string; url: string };

export async function sendPush(sub: StoredSub, payload: PushPayload) {
  return webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload)
  );
}
