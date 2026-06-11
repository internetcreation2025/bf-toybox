import { createClient } from "@supabase/supabase-js";

// Server-only admin client that bypasses row-level security. It is used ONLY by
// the secret-protected cron dispatcher, which has no logged-in user session and
// must read across the owner's sealed envelopes + push subscriptions.
// NEVER import this into client components.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing Supabase admin credentials.");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
