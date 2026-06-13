"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resizeImage } from "@/lib/image";
import { FOOT_ANGLES } from "@/lib/feet";
import { FootCare } from "@/components/FootCare";

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
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [profiling, setProfiling] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [detailLabel, setDetailLabel] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const [openReadings, setOpenReadings] = useState<Record<string, boolean>>({});
  const [rereading, setRereading] = useState<string | null>(null);
  const [requests, setRequests] = useState<
    Array<{ id: string; label: string; reason: string | null }>
  >([]);
  const [asking, setAsking] = useState(false);
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

    // One consolidated profile per angle (resilient if the table isn't there).
    const { data: profRows } = await supabase
      .from("bf_foot_angle_profiles")
      .select("angle, profile");
    const profMap: Record<string, string> = {};
    for (const p of profRows ?? []) {
      if (p.profile) profMap[p.angle as string] = p.profile as string;
    }
    setProfiles(profMap);

    // Open close-up requests from the Decider (resilient if the table is absent).
    const { data: reqRows } = await supabase
      .from("bf_detail_requests")
      .select("id, label, reason")
      .eq("status", "open")
      .order("created_at", { ascending: false });
    setRequests(
      (reqRows ?? []) as Array<{ id: string; label: string; reason: string | null }>
    );
  }, [supabase]);

  async function askDecider() {
    setAsking(true);
    setError("");
    try {
      const res = await fetch("/api/feet/request-detail", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Couldn't ask the Decider");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't ask the Decider");
    } finally {
      setAsking(false);
    }
  }

  async function dismissRequest(id: string) {
    await supabase
      .from("bf_detail_requests")
      .update({ status: "dismissed" })
      .eq("id", id);
    setRequests((rs) => rs.filter((r) => r.id !== id));
  }

  async function buildProfile(angle: string) {
    setProfiling(angle);
    setError("");
    try {
      const res = await fetch("/api/feet/angle-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ angle }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Couldn't build the profile");
      setProfiles((p) => ({ ...p, [angle]: json.profile }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the profile");
    } finally {
      setProfiling(null);
    }
  }

  // Re-run the AI reading on a spot's latest photo (e.g. after a prompt fix, or
  // if the first read came back empty).
  async function rereadDetail(label: string, id: string) {
    setRereading(label);
    setError("");
    try {
      const res = await fetch("/api/feet/fingerprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Couldn't read that spot");
      await load();
      setOpenReadings((o) => ({ ...o, [label]: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that spot");
    } finally {
      setRereading(null);
    }
  }

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
      // If the Decider had asked for this spot, mark her request fulfilled.
      const norm = (s: string) => s.trim().toLowerCase();
      const fulfilled = requests.filter((r) => norm(r.label) === norm(label));
      for (const r of fulfilled) {
        await supabase
          .from("bf_detail_requests")
          .update({ status: "done" })
          .eq("id", r.id);
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
            className="text-sm text-muted hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Teach it my feet
          </h1>
          <p className="mt-1 text-sm text-muted">
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

      {/* What the Decider wants a closer look at */}
      <section className="mt-8 rounded-xl border border-line p-4 dark:border-line">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            The Decider wants a closer look
          </h2>
          <button
            type="button"
            onClick={askDecider}
            disabled={asking}
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-line dark:hover:bg-neutral-900"
          >
            {asking ? "Asking…" : "Ask what she wants to see"}
          </button>
        </div>
        {requests.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Nothing outstanding. Ask, and she&apos;ll name a spot she&apos;d like
            a close-up of.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {requests.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 dark:border-line"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.label}</p>
                  {r.reason && (
                    <p className="text-xs italic text-muted">
                      “{r.reason}”
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs">
                  <button
                    type="button"
                    disabled={detailBusy}
                    onClick={() => {
                      setDetailLabel(r.label);
                      pendingLabelRef.current = r.label;
                      detailInputRef.current?.click();
                    }}
                    className="rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
                  >
                    Add photo
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissRequest(r.id)}
                    className="text-muted hover:text-neutral-900 dark:hover:text-neutral-100"
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FOOT_ANGLES.map((a) => (
          <AngleCard
            key={a.key}
            label={a.label}
            rows={rowsByAngle[a.key] ?? []}
            urls={urls}
            busy={busy === a.key}
            profile={profiles[a.key]}
            profiling={profiling === a.key}
            onBuildProfile={() => buildProfile(a.key)}
            onView={setLightbox}
            onDelete={handleDelete}
            onPick={(file) => handleUpload(a.key, file)}
          />
        ))}
      </div>

      {/* Detail close-ups — labelled landmarks, grouped into per-spot timelines */}
      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Detail close-ups
        </h2>
        <p className="mt-1 text-sm text-muted">
          Extreme close-ups of specific spots — label each precisely (e.g. “pad
          of toe 2, right foot”). Each spot keeps a dated series, so you can
          watch it change over time. The Decider can refer to a spot, request a
          fresh shot of it, and verify it.
        </p>

        {/* Add a NEW spot */}
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line p-4 dark:border-line">
          <input
            value={detailLabel}
            onChange={(e) => setDetailLabel(e.target.value)}
            placeholder='New spot, e.g. "between little toe & toe 4, right"'
            className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-neutral-950"
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
          // Latest reading in this spot (newest photo with AI text).
          const latestRead = [...rows]
            .reverse()
            .find((r) => r.ai_fingerprint)?.ai_fingerprint;
          const reading = openReadings[label];
          return (
            <div
              key={label}
              className="mt-4 rounded-xl border border-line p-4 dark:border-line"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{label}</p>
                <div className="flex shrink-0 items-center gap-3">
                  {latestRead && (
                    <button
                      type="button"
                      onClick={() =>
                        setOpenReadings((o) => ({ ...o, [label]: !o[label] }))
                      }
                      className="text-xs text-muted hover:text-neutral-900 dark:hover:text-neutral-100"
                    >
                      {reading ? "Hide reading" : "What it sees"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={rereading === label}
                    onClick={() =>
                      rereadDetail(label, rows[rows.length - 1].id)
                    }
                    className="text-xs text-muted hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
                  >
                    {rereading === label
                      ? "Reading…"
                      : latestRead
                      ? "Re-read"
                      : "Read it"}
                  </button>
                  <button
                    type="button"
                    disabled={detailBusy}
                    onClick={() => {
                      pendingLabelRef.current = label;
                      detailInputRef.current?.click();
                    }}
                    className="text-xs text-muted hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
                  >
                    + Add to this spot
                  </button>
                </div>
              </div>

              {reading && latestRead && (
                <p className="mt-2 whitespace-pre-line rounded-lg bg-neutral-50 p-3 text-xs italic leading-relaxed text-neutral-600 dark:bg-neutral-950 dark:text-neutral-300">
                  {latestRead}
                </p>
              )}
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {rows.map((r) => (
                  <div key={r.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => urls[r.id] && setLightbox(urls[r.id])}
                      className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-line bg-neutral-50 dark:border-line dark:bg-neutral-950"
                    >
                      {urls[r.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={urls[r.id]}
                          alt={label}
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-xs text-muted">…</span>
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
                    <p className="mt-1 text-center text-[10px] text-muted">
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

      <FootCare />

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
  profile,
  profiling,
  onBuildProfile,
  onView,
  onDelete,
  onPick,
}: {
  label: string;
  rows: RefRow[];
  urls: Record<string, string>;
  busy: boolean;
  profile?: string;
  profiling: boolean;
  onBuildProfile: () => void;
  onView: (url: string) => void;
  onDelete: (row: RefRow) => void;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showProfile, setShowProfile] = useState(false);
  const learned = rows.some((r) => r.ai_fingerprint);

  return (
    <div className="rounded-xl border border-line p-4 dark:border-line">
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
              className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-line bg-neutral-50 dark:border-line dark:bg-neutral-950"
            >
              {urls[r.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={urls[r.id]}
                  alt={label}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-muted">…</span>
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
          className="flex aspect-square w-full flex-col items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted hover:border-accent disabled:opacity-60 dark:border-line"
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

      {busy && <p className="mt-2 text-xs text-muted">Analysing…</p>}

      {/* One consolidated profile for this angle, built from all its photos */}
      <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-line">
        <div className="flex items-center justify-between gap-2">
          {profile ? (
            <button
              onClick={() => setShowProfile((v) => !v)}
              className="text-xs font-medium text-muted hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              {showProfile ? "Hide profile" : "View profile"}
            </button>
          ) : (
            <span className="text-xs text-muted">No profile yet</span>
          )}
          <button
            onClick={onBuildProfile}
            disabled={profiling || rows.length === 0}
            className="text-xs text-muted hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
          >
            {profiling
              ? "Building…"
              : profile
              ? "Refresh profile"
              : "Build profile"}
          </button>
        </div>
        {profile && showProfile && (
          <p className="mt-2 text-xs italic leading-relaxed text-neutral-600 dark:text-neutral-300">
            {profile}
          </p>
        )}
      </div>
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
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span className={`h-2 w-2 rounded-full ${colour}`} />
      {text}
    </span>
  );
}
