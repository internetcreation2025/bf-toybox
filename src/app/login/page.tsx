"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [googleBusy, setGoogleBusy] = useState(false);

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

  async function handleGoogle() {
    setGoogleBusy(true);
    const supabase = createClient();
    // The /auth/callback route enforces the single-email allowlist, so even a
    // successful Google sign-in by anyone else is rejected there.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      console.error("google oauth error:", error.message);
      setGoogleBusy(false);
    }
    // On success the browser is redirected to Google — no further UI needed.
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
          <div className="space-y-4">
            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleBusy}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-neutral-300 px-4 py-3 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              <GoogleIcon />
              {googleBusy ? "Redirecting…" : "Continue with Google"}
            </button>

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
              <span className="text-xs uppercase tracking-wide text-neutral-400">
                or
              </span>
              <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                required
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
            </form>

            <p className="text-center text-xs text-neutral-400">
              Access is restricted to the owner&apos;s email, with an
              authenticator code required.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
