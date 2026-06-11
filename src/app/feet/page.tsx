"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resizeImage } from "@/lib/image";
import { FOOT_ANGLES } from "@/lib/feet";

type RefRow = {
  id: string;
  angle: string;
  photo_path: string;
  ai_fingerprint: string | null;
};

export default function FeetPage() {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, RefRow>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data } = await supabase.from("bf_foot_refs").select("*");
    const byAngle: Record<string, RefRow> = {};
    const signed: Record<string, string> = {};
    for (const r of (data ?? []) as RefRow[]) {
      byAngle[r.angle] = r;
      const { data: s } = await supabase.storage
        .from("bf-feet")
        .createSignedUrl(r.photo_path, 3600);
      if (s?.signedUrl) signed[r.angle] = s.signedUrl;
    }
    setRefs(byAngle);
    setUrls(signed);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(angle: string, file: File) {
    if (!userId) return;
    setBusy(angle);
    setError("");
    try {
      const blob = await resizeImage(file);
      const path = `${userId}/feet/${angle}.jpg`;

      const { error: upErr } = await supabase.storage
        .from("bf-feet")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (upErr) throw upErr;

      const { error: rowErr } = await supabase.from("bf_foot_refs").upsert(
        { user_id: userId, angle, photo_path: path, ai_fingerprint: null },
        { onConflict: "user_id,angle" }
      );
      if (rowErr) throw rowErr;

      const res = await fetch("/api/feet/fingerprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ angle }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "fingerprint failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  const learnedCount = Object.values(refs).filter(
    (r) => r.ai_fingerprint
  ).length;

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/"
            className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Teach it my feet
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Upload one clean, barefoot photo per angle. Each is analysed and
            remembered so proof photos can be matched later.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-neutral-100 px-3 py-1 text-sm text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
          {learnedCount}/{FOOT_ANGLES.length} learned
        </span>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40">
          {error}
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FOOT_ANGLES.map((a) => (
          <AngleCard
            key={a.key}
            label={a.label}
            url={urls[a.key]}
            ref_={refs[a.key]}
            busy={busy === a.key}
            onPick={(file) => handleUpload(a.key, file)}
          />
        ))}
      </div>
    </main>
  );
}

function AngleCard({
  label,
  url,
  ref_,
  busy,
  onPick,
}: {
  label: string;
  url?: string;
  ref_?: RefRow;
  busy: boolean;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const learned = !!ref_?.ai_fingerprint;
  const uploaded = !!ref_;

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <StatusDot busy={busy} uploaded={uploaded} learned={learned} />
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="mt-3 block aspect-[4/3] w-full overflow-hidden rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-sm text-neutral-400 transition-colors hover:border-neutral-400 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-950"
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span>Tap to add photo</span>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />

      {busy && (
        <p className="mt-2 text-xs text-neutral-500">Analysing…</p>
      )}

      {learned && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-neutral-500">
            View fingerprint
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
            {ref_?.ai_fingerprint}
          </pre>
        </details>
      )}
    </div>
  );
}

function StatusDot({
  busy,
  uploaded,
  learned,
}: {
  busy: boolean;
  uploaded: boolean;
  learned: boolean;
}) {
  const colour = busy
    ? "bg-amber-500"
    : learned
    ? "bg-green-500"
    : uploaded
    ? "bg-amber-500"
    : "bg-neutral-300 dark:bg-neutral-700";
  const text = busy
    ? "Analysing"
    : learned
    ? "Learned"
    : uploaded
    ? "Not analysed"
    : "Empty";
  return (
    <span className="flex items-center gap-1.5 text-xs text-neutral-500">
      <span className={`h-2 w-2 rounded-full ${colour}`} />
      {text}
    </span>
  );
}
