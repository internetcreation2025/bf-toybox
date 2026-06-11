"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resizeImage } from "@/lib/image";

type Shot = {
  id: string;
  prompt: string;
  status: string;
  photo_path: string | null;
  note: string | null;
  created_at: string;
  filed_at: string | null;
};

export default function GalleryPage() {
  const supabase = createClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const targetId = useRef<string | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data } = await supabase
      .from("bf_gallery")
      .select("id, prompt, status, photo_path, note, created_at, filed_at")
      .order("created_at", { ascending: false });

    const rows = (data as Shot[]) ?? [];
    setShots(rows);

    // Sign URLs for any filed photos so they render.
    const next: Record<string, string> = {};
    for (const s of rows) {
      if (s.photo_path) {
        const { data: signed } = await supabase.storage
          .from("bf-feet")
          .createSignedUrl(s.photo_path, 3600);
        if (signed?.signedUrl) next[s.id] = signed.signedUrl;
      }
    }
    setUrls(next);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(file: File) {
    const id = targetId.current;
    if (!userId || !id) return;
    setBusyId(id);
    setError("");
    try {
      const blob = await resizeImage(file);
      const path = `${userId}/gallery/${id}.jpg`;

      const { error: upErr } = await supabase.storage
        .from("bf-feet")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (upErr) throw upErr;

      const { error: rowErr } = await supabase
        .from("bf_gallery")
        .update({ photo_path: path })
        .eq("id", id);
      if (rowErr) throw rowErr;

      const res = await fetch("/api/gallery/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Filing failed");

      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusyId(null);
      targetId.current = null;
    }
  }

  const pending = shots.filter((s) => s.status === "pending");
  const filed = shots.filter((s) => s.status === "filed");

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link
        href="/"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight">The file</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Close-ups the Roaster demanded for the record. It draws on these to needle
        you in future rolls.
      </p>

      {/* Hidden file input, shared by every pending demand. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
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

      {loading ? (
        <p className="mt-8 text-sm text-neutral-500">Loading…</p>
      ) : (
        <>
          {pending.length > 0 && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Wanted for the file
              </h2>
              <div className="mt-3 space-y-3">
                {pending.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30"
                  >
                    <p className="text-sm text-amber-900 dark:text-amber-200">
                      {s.prompt}
                    </p>
                    <button
                      type="button"
                      disabled={busyId === s.id}
                      onClick={() => {
                        targetId.current = s.id;
                        inputRef.current?.click();
                      }}
                      className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-neutral-900"
                    >
                      {busyId === s.id ? "Filing…" : "Submit the shot"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {filed.length > 0 && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                On record
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {filed.map((s) => (
                  <figure
                    key={s.id}
                    className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800"
                  >
                    {urls[s.id] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={urls[s.id]}
                        alt={s.prompt}
                        className="aspect-square w-full object-cover"
                      />
                    )}
                    <figcaption className="space-y-1 p-3">
                      <p className="text-xs text-neutral-400">{s.prompt}</p>
                      {s.note && (
                        <p className="text-sm italic text-neutral-700 dark:text-neutral-300">
                          {s.note}
                        </p>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}

          {pending.length === 0 && filed.length === 0 && (
            <p className="mt-8 text-sm text-neutral-500">
              Nothing on file yet. When the Roaster&apos;s in charge, it&apos;ll
              demand the odd close-up here.
            </p>
          )}
        </>
      )}
    </main>
  );
}
