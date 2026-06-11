import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  // Lightweight connection check: ask Supabase for the current auth session.
  // This confirms the URL + key are valid without needing any tables yet.
  let connected = false;
  let detail = "";
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.getSession();
    connected = !error;
    detail = error ? error.message : "Auth endpoint reachable";
  } catch (e) {
    detail = e instanceof Error ? e.message : "Unknown error";
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(not set)";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">bf-toybox</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Next.js + Supabase starter
        </p>
      </div>

      <div className="w-full max-w-md rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              connected ? "bg-green-500" : "bg-red-500"
            }`}
            aria-hidden
          />
          <span className="font-medium">
            {connected ? "Supabase connected" : "Supabase not connected"}
          </span>
        </div>
        <dl className="mt-4 space-y-1 text-sm text-neutral-500">
          <div className="flex justify-between gap-4">
            <dt>Project URL</dt>
            <dd className="truncate font-mono text-xs">{url}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Status</dt>
            <dd className="text-right">{detail}</dd>
          </div>
        </dl>
      </div>
    </main>
  );
}
