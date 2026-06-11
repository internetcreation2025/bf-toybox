"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        // Never create a new account from the login form — only existing users
        // (i.e. the owner) can receive a link.
        shouldCreateUser: false,
      },
    });

    // Always show the same confirmation, regardless of whether the email exists,
    // so the form can't be used to discover which accounts are registered.
    if (error) console.error("login otp error:", error.message);
    setStatus("sent");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Sole Decider</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Private. Sign in to continue.
          </p>
        </div>

        {status === "sent" ? (
          <div className="rounded-xl border border-neutral-200 p-6 text-center dark:border-neutral-800">
            <p className="font-medium">Check your email</p>
            <p className="mt-2 text-sm text-neutral-500">
              If that address is registered, a one-time sign-in link is on its
              way. Open it on this device to log in.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-neutral-300 px-4 py-3 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {status === "sending" ? "Sending…" : "Send magic link"}
            </button>
            <p className="text-center text-xs text-neutral-400">
              Access is restricted to the owner&apos;s email, with an
              authenticator code required.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
