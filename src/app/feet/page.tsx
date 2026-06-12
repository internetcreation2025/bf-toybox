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
  label: string | null;
  created_at: string;
};

export default function FeetPage() {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [rowsByAngle, setRowsByAngle] = useState<Record<string, RefRow[]>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [detailLabel, setDetailLabel] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const detailInputRef = useRef<HTMLInputElement>(null);
  const pendingLabelRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data } = await supabase
      .from("bf_foot_refs")
      .select("*")
      .order("created_at", { ascending: true });

    const grouped: Record<string, RefRow[]> = {};
    const signed: Record<string, string> = {};
    for (const r of (data ?? []) as RefRow[]) {
      (grouped[r.angle] ??= []).push(r);
      const { data: s } = await supabase.storage
        .from("bf-feet")
        .createSignedUrl(r.photo_path, 3600);
      if (s?.signedUrl) signed[r.id] = s.signedUrl;
    }
    setRowsByAngle(grouped);
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
      const fileId = crypto.randomUUID();
      const path = `${userId}/feet/${angle}/${fileId}.jpg`;

      const { error: upErr } = await supabase.storage
        .from("bf-feet")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (upErr) throw upErr;

      const { data: inserted, error: insErr } = await supabase
        .from("bf_foot_refs")
        .insert({ user_id: userId, angle, photo_path: path, ai_fingerprint: null })
        .select("id")
        .single();
      if (insErr || !inserted) {
        throw new Error(
          insErr?.message?.includes("duplicate")
            ? "Run the multi-photo SQL first to allow more than one per angle."
            : insErr?.message ?? "Could not save"
        );
      }

      const res = await fetch("/api/feet/fingerprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: inserted.id }),
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

  async function handleDelete(row: RefRow) {
    if (!confirm("Remove this photo?")) return;
    await supabase.storage.from("bf-feet").remove([row.photo_path]);
    await supabase.from("bf_foot_refs").delete().eq("id", row.id);
    await load();
  }

  // A labelled extreme close-up of a specific spot (e.g. "pad of toe 2, right").
  async function handleAddDetail(label: string, file: File) {
    if (!userId || !label.trim()) return;
    setDetailBusy(true);
    setError("");
    try {
      const blob = await resizeImage(file);
      const fileId = crypto.randomUUID();
      const path = `${userId}/feet/detail/${fileId}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("bf-feet")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (upErr) throw upErr;

      const { data: inserted, error: insErr } = await supabase
        .from("bf_foot_refs")
        .insert({
          user_id: userId,
          angle: "detail",
          label: label.trim(),
          photo_path: path,
          ai_fingerprint: null,
        })
        .select("id")
        .single();
      if (insErr || !inserted) {
        throw new Error(
          insErr?.message?.includes("duplicate") ||
          insErr?.message?.includes("label")
            ? "Run the detail close-ups SQL first."
            : insErr?.message ?? "Could not save"
        );
      }

      const res = await fetch("/api/feet/fingerprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: inserted.id }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "fingerprint failed");
      }
      setDetailLabel("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setDetailBusy(false);
    }
  }

  const learnedAngles = FOOT_ANGLES.filter((a) =>
    (rowsByAngle[a.key] ?? []).some((r) => r.ai_fingerprint)
  ).length;
  const totalPhotos = Object.values(rowsByAngle).reduce(
    (n, rows) => n + rows.length,
    0
  );
  const details = rowsByAngle["detail"] ?? [];
  // Group the detail close-ups by label into per-spot timelines (oldest first).
  const detailGroups = Object.values(
    details.reduce<Record<string, RefRow[]>>((acc, r) => {
      const k = r.label ?? "—";
      (acc[k] ??= []).push(r);
      return acc;
    }, {})
  ).sort((a, b) => (a[0].label ?? "").localeCompare(b[0].label ?? ""));

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
            Add as many photos per angle as you like — the more it sees, the
            better it knows your feet, and the more material the games have.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-neutral-100 px-3 py-1 text-sm text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
          {learnedAngles}/{FOOT_ANGLES.length} angles · {totalPhotos} photos
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
            rows={rowsByAngle[a.key] ?? []}
            urls={urls}
            busy={busy === a.key}
            onView={setLightbox}
            onDelete={handleDelete}
            onPick={(file) => handleUpload(a.key, file)}
          />
        ))}
      </div>

      {/* Detail close-ups — labelled landmarks, grouped into per-spot timelines */}
      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Detail close-ups
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Extreme close-ups of specific spots — label each precisely (e.g. “pad
          of toe 2, right foot”). Each spot keeps a dated series, so you can
          watch it change over time. The Decider can refer to a spot, request a
          fresh shot of it, and verify it.
        </p>

        {/* Add a NEW spot */}
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <input
            value={detailLabel}
            onChange={(e) => setDetailLabel(e.target.value)}
            placeholder='New spot, e.g. "between little toe & toe 4, right"'
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
          />
          <button
            type="button"
            disabled={!detailLabel.trim() || detailBusy}
            onClick={() => {
              pendingLabelRef.current = null;
              detailInputRef.current?.click();
            }}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {detailBusy ? "Adding…" : "Add photo"}
          </button>
          <input
            ref={detailInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              const lbl = pendingLabelRef.current ?? detailLabel;
              if (f && lbl.trim()) handleAddDetail(lbl, f);
              pendingLabelRef.current = null;
              e.target.value = "";
            }}
          />
        </div>

        {/* Existing spots, each a dated timeline */}
        {detailGroups.map((rows) => {
          const label = rows[0].label ?? "—";
          return (
            <div
              key={label}
              className="mt-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{label}</p>
                <button
                  type="button"
                  disabled={detailBusy}
                  onClick={() => {
                    pendingLabelRef.current = label;
                    detailInputRef.current?.click();
                  }}
                  className="text-xs text-neutral-500 hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
                >
                  + Add to this spot
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {rows.map((r) => (
                  <div key={r.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => urls[r.id] && setLightbox(urls[r.id])}
                      className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950"
                    >
                      {urls[r.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={urls[r.id]}
                          alt={label}
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-xs text-neutral-400">…</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(r)}
                      aria-label="Remove"
                      className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      ×
                    </button>
                    <p className="mt-1 text-center text-[10px] text-neutral-400">
                      {r.created_at.slice(0, 10)}
                      {!r.ai_fingerprint && " ·…"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Foot reference"
            className="max-h-[90vh] max-w-full rounded-xl object-contain"
          />
        </div>
      )}
    </main>
  );
}

function AngleCard({
  label,
  rows,
  urls,
  busy,
  onView,
  onDelete,
  onPick,
}: {
  label: string;
  rows: RefRow[];
  urls: Record<string, string>;
  busy: boolean;
  onView: (url: string) => void;
  onDelete: (row: RefRow) => void;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const learned = rows.some((r) => r.ai_fingerprint);

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <StatusDot busy={busy} count={rows.length} learned={learned} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {rows.map((r) => (
          <div key={r.id} className="group relative">
            <button
              type="button"
              onClick={() => urls[r.id] && onView(urls[r.id])}
              className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950"
            >
              {urls[r.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={urls[r.id]}
                  alt={label}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-neutral-400">…</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onDelete(r)}
              aria-label="Remove photo"
              className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex aspect-square w-full flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 text-xs text-neutral-400 hover:border-neutral-400 disabled:opacity-60 dark:border-neutral-700"
        >
          {busy ? "…" : "+ Add"}
        </button>
      </div>

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

      {busy && <p className="mt-2 text-xs text-neutral-500">Analysing…</p>}
    </div>
  );
}

function StatusDot({
  busy,
  count,
  learned,
}: {
  busy: boolean;
  count: number;
  learned: boolean;
}) {
  const colour = busy
    ? "bg-amber-500"
    : learned
    ? "bg-green-500"
    : count > 0
    ? "bg-amber-500"
    : "bg-neutral-300 dark:bg-neutral-700";
  const text = busy
    ? "Analysing"
    : learned
    ? `Learned · ${count}`
    : count > 0
    ? "Not analysed"
    : "Empty";
  return (
    <span className="flex items-center gap-1.5 text-xs text-neutral-500">
      <span className={`h-2 w-2 rounded-full ${colour}`} />
      {text}
    </span>
  );
}
