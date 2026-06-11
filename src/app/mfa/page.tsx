"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "loading" | "enroll" | "challenge" | "error";

export default function MfaPage() {
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const init = useCallback(async () => {
    try {
      const { data: aal } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") {
        window.location.href = "/";
        return;
      }

      const { data: factors, error: lErr } =
        await supabase.auth.mfa.listFactors();
      if (lErr) throw lErr;

      const verified = factors?.totp?.find((f) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setMode("challenge");
        return;
      }

      // No verified factor — clear any half-finished ones, then enrol fresh.
      for (const f of factors?.all ?? []) {
        if (f.status !== "verified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const { data: en, error: eErr } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "authenticator",
      });
      if (eErr || !en) throw eErr ?? new Error("enrolment failed");
      setFactorId(en.id);
      setQr(en.totp.qr_code);
      setSecret(en.totp.secret);
      setMode("enroll");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start MFA");
      setMode("error");
    }
  }, [supabase]);

  useEffect(() => {
    init();
  }, [init]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({
        factorId,
      });
      if (cErr || !ch) throw cErr ?? new Error("challenge failed");
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: ch.id,
        code: code.trim(),
      });
      if (vErr) throw vErr;
      // Full reload so the proxy re-reads the upgraded (aal2) session.
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect code");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Authenticator
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            {mode === "enroll"
              ? "Scan this with your authenticator app, then enter the 6-digit code."
              : mode === "challenge"
              ? "Enter the 6-digit code from your authenticator app."
              : mode === "loading"
              ? "Preparing…"
              : "Something went wrong."}
          </p>
        </div>

        {mode === "enroll" && qr && (
          <div className="mb-4 flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qr}
              alt="Authenticator QR code"
              className="h-48 w-48 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800"
            />
            <p className="text-center text-xs text-neutral-400">
              Can&apos;t scan? Enter this key manually:
              <br />
              <span className="font-mono break-all">{secret}</span>
            </p>
          </div>
        )}

        {(mode === "enroll" || mode === "challenge") && (
          <form onSubmit={submit} className="space-y-4">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="000000"
              className="w-full rounded-lg border border-neutral-300 px-4 py-3 text-center text-lg tracking-[0.4em] outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
            />
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
          </form>
        )}

        {error && (
          <p className="mt-4 text-center text-sm text-red-500">{error}</p>
        )}

        <form action="/auth/signout" method="post" className="mt-6 text-center">
          <button
            type="submit"
            className="text-xs text-neutral-400 hover:text-neutral-600"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
