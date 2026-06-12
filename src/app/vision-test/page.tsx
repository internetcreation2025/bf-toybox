"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resizeImage } from "@/lib/image";

// Unambiguous characters (no O/0, I/1) so the read is fair.
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  let c = "";
  for (let i = 0; i < 5; i++) c += CHARS[Math.floor(Math.random() * CHARS.length)];
  return c;
}
function normalise(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

type Outcome = {
  pass: boolean;
  read: string;
  description: string;
  previewUrl: string;
};

export default function VisionTestPage() {
  const supabase = createClient();
  const [code, setCode] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const init = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);
  }, [supabase]);

  useEffect(() => {
    setCode(makeCode());
    init();
  }, [init]);

  function reset() {
    setCode(makeCode());
    setOutcome(null);
    setError("");
  }

  async function handleUpload(file: File) {
    if (!userId) return;
    setBusy(true);
    setError("");
    setOutcome(null);
    try {
      const blob = await resizeImage(file);
      const path = `${userId}/vision-test/test.jpg`;
      const { error: upErr } = await supabase.storage
        .from("bf-feet")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (upErr) throw upErr;

      const res = await fetch("/api/vision-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Vision test failed");

      const { data: signed } = await supabase.storage
        .from("bf-feet")
        .createSignedUrl(path, 3600);

      setOutcome({
        pass: normalise(json.code || "") === normalise(code),
        read: json.code || "(nothing readable)",
        description: json.description || "",
        previewUrl: signed?.signedUrl ?? "",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <Link
        href="/"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Vision test</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Proves the whole chain works: your phone photo uploads, and the AI reads
        fine detail. Write the code below by hand, photograph it, and upload.
      </p>

      {/* The challenge code */}
      <div className="mt-6 rounded-2xl border border-neutral-200 p-6 text-center dark:border-neutral-800">
        <p className="text-xs uppercase tracking-wide text-neutral-400">
          Write this exactly
        </p>
        <p className="mt-2 font-mono text-4xl font-bold tracking-[0.2em]">
          {code}
        </p>
        <button
          onClick={reset}
          className="mt-3 text-xs text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          New code
        </button>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {busy ? "Reading the photo…" : "Take / upload the photo"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUpload(f);
          e.target.value = "";
        }}
      />

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40">
          {error}
        </p>
      )}

      {outcome && (
        <div className="mt-6 space-y-4">
          <div
            className={`rounded-xl border-2 p-5 ${
              outcome.pass
                ? "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/30"
                : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
            }`}
          >
            <p className="text-sm font-semibold">
              {outcome.pass
                ? "PASS — the AI read your code correctly."
                : "Mismatch — the AI didn't read the exact code."}
            </p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              You wrote <span className="font-mono font-semibold">{code}</span> · AI
              read <span className="font-mono font-semibold">{outcome.read}</span>
            </p>
          </div>

          {outcome.description && (
            <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                What the AI saw
              </p>
              <p className="mt-1 text-sm italic text-neutral-700 dark:text-neutral-300">
                {outcome.description}
              </p>
            </div>
          )}

          {outcome.previewUrl && (
            <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={outcome.previewUrl}
                alt="Your upload"
                className="max-h-80 w-full object-contain"
              />
            </div>
          )}

          <button
            onClick={reset}
            className="w-full rounded-lg border border-neutral-300 px-4 py-3 text-sm dark:border-neutral-700"
          >
            Test again with a new code
          </button>
        </div>
      )}
    </main>
  );
}
