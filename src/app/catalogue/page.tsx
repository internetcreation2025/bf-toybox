"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resizeImage } from "@/lib/image";
import type { Dossier } from "@/lib/decider";
import {
  FOOTWEAR_CATEGORIES,
  prettyCategory,
  type FootwearCategory,
} from "@/lib/feet";

type Item = {
  id: string;
  name: string;
  category: string;
  colour: string | null;
  notes: string | null;
  photo_path: string | null;
  dossier: Dossier | null;
  worn_hours: number | null;
  played_count: number | null;
  dried_count: number | null;
  sockless_count: number | null;
  last_washed_at: string | null;
};

export default function CataloguePage() {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [category, setCategory] = useState<FootwearCategory>("trainers");
  const [colour, setColour] = useState("");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  // Filtering + full-size viewing.
  const [filter, setFilter] = useState<string>("all");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data } = await supabase
      .from("bf_footwear")
      .select("*")
      .order("created_at", { ascending: false });
    const list = (data ?? []) as Item[];
    setItems(list);

    const signed: Record<string, string> = {};
    for (const it of list) {
      if (it.photo_path) {
        const { data: s } = await supabase.storage
          .from("bf-feet")
          .createSignedUrl(it.photo_path, 3600);
        if (s?.signedUrl) signed[it.id] = s.signedUrl;
      }
    }
    setUrls(signed);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // Ask Claude to (re)profile an item's photo into a dossier.
  const profile = useCallback(async (id: string) => {
    await fetch("/api/footwear/dossier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const { data: inserted, error: insErr } = await supabase
        .from("bf_footwear")
        .insert({
          user_id: userId,
          name: name.trim(),
          category,
          colour: colour.trim() || null,
          notes: notes.trim() || null,
        })
        .select("id")
        .single();
      if (insErr || !inserted) throw insErr ?? new Error("insert failed");

      if (photo) {
        const blob = await resizeImage(photo);
        const path = `${userId}/footwear/${inserted.id}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("bf-feet")
          .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
        if (upErr) throw upErr;
        await supabase
          .from("bf_footwear")
          .update({ photo_path: path })
          .eq("id", inserted.id);
        // Profile the photo in the background — don't block the form.
        profile(inserted.id);
      }

      setName("");
      setColour("");
      setNotes("");
      setPhoto(null);
      setCategory("trainers");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(it: Item) {
    if (!confirm(`Remove "${it.name}"?`)) return;
    if (it.photo_path) {
      await supabase.storage.from("bf-feet").remove([it.photo_path]);
    }
    await supabase.from("bf_footwear").delete().eq("id", it.id);
    await load();
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link
        href="/"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Footwear catalogue
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        Everything you own — the Decider picks from this and tracks how worn each
        pair is. Add socks here too, with photos.
      </p>

      <form
        onSubmit={handleAdd}
        className="mt-6 space-y-3 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Black Adidas slides)"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FootwearCategory)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm capitalize outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
          >
            {FOOTWEAR_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {prettyCategory(c)}
              </option>
            ))}
          </select>
          <input
            value={colour}
            onChange={(e) => setColour(e.target.value)}
            placeholder="Colour (optional)"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            className="text-sm text-neutral-500 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm dark:file:bg-neutral-800"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {saving ? "Saving…" : "Add"}
          </button>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </form>

      {/* Filter by category */}
      {items.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {(["all", ...FOOTWEAR_CATEGORIES.filter((c) =>
            items.some((it) => it.category === c)
          )] as string[]).map((c) => {
            const on = filter === c;
            const count =
              c === "all"
                ? items.length
                : items.filter((it) => it.category === c).length;
            return (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={`rounded-full border px-3 py-1.5 text-sm capitalize transition-colors ${
                  on
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                    : "border-neutral-300 dark:border-neutral-700"
                }`}
              >
                {c === "all" ? "All" : prettyCategory(c)}{" "}
                <span className={on ? "opacity-70" : "text-neutral-400"}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.length === 0 && (
          <p className="text-sm text-neutral-400">No footwear yet.</p>
        )}
        {items
          .filter((it) => filter === "all" || it.category === filter)
          .map((it) => (
            <ItemCard
              key={it.id}
              it={it}
              url={urls[it.id]}
              userId={userId}
              onView={setLightbox}
              onDelete={() => handleDelete(it)}
              onReprofile={async () => {
                await profile(it.id);
                await load();
              }}
              onChanged={load}
            />
          ))}
      </div>

      {/* Full-size photo viewer */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Footwear"
            className="max-h-[90vh] max-w-full rounded-xl object-contain"
          />
        </div>
      )}
    </main>
  );
}

function ItemCard({
  it,
  url,
  userId,
  onView,
  onDelete,
  onReprofile,
  onChanged,
}: {
  it: Item;
  url?: string;
  userId: string | null;
  onView: (url: string) => void;
  onDelete: () => void;
  onReprofile: () => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hours, setHours] = useState("");
  const [played, setPlayed] = useState(false);
  const [dried, setDried] = useState(false);

  // Editing the item's details.
  const [editing, setEditing] = useState(false);
  const [eName, setEName] = useState(it.name);
  const [eCategory, setECategory] = useState(it.category);
  const [eColour, setEColour] = useState(it.colour ?? "");
  const [eNotes, setENotes] = useState(it.notes ?? "");
  const [ePhoto, setEPhoto] = useState<File | null>(null);
  const [editErr, setEditErr] = useState("");

  function startEdit() {
    setEName(it.name);
    setECategory(it.category);
    setEColour(it.colour ?? "");
    setENotes(it.notes ?? "");
    setEPhoto(null);
    setEditErr("");
    setEditing(true);
  }

  async function saveEdit() {
    if (!eName.trim()) {
      setEditErr("Name can't be empty.");
      return;
    }
    setBusy(true);
    setEditErr("");
    try {
      await supabase
        .from("bf_footwear")
        .update({
          name: eName.trim(),
          category: eCategory,
          colour: eColour.trim() || null,
          notes: eNotes.trim() || null,
        })
        .eq("id", it.id);

      // New photo → upload, point the row at it, and re-profile.
      if (ePhoto && userId) {
        const blob = await resizeImage(ePhoto);
        const path = `${userId}/footwear/${it.id}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("bf-feet")
          .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
        if (upErr) throw upErr;
        await supabase
          .from("bf_footwear")
          .update({ photo_path: path })
          .eq("id", it.id);
        await fetch("/api/footwear/dossier", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: it.id }),
        });
      }

      setEditing(false);
      await onChanged();
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const isSock = it.category === "socks";
  const wornHours = it.worn_hours ?? 0;
  const playedCount = it.played_count ?? 0;
  const driedCount = it.dried_count ?? 0;
  const socklessCount = it.sockless_count ?? 0;

  // Socks carry hours + wash state; shoes only carry a "worn bare" tally.
  const wearBits: string[] = [];
  if (isSock) {
    if (wornHours > 0) wearBits.push(`${Math.round(wornHours)}h since wash`);
    if (playedCount > 0) wearBits.push(`played ${playedCount}×`);
    if (driedCount > 0) wearBits.push(`dried ${driedCount}×`);
  } else if (socklessCount > 0) {
    wearBits.push(`worn bare ${socklessCount}×`);
  }

  async function logWear() {
    setBusy(true);
    const h = Number(hours) || 0;
    await supabase
      .from("bf_footwear")
      .update({
        worn_hours: wornHours + h,
        played_count: playedCount + (played ? 1 : 0),
        dried_count: driedCount + (dried ? 1 : 0),
        last_worn_at: new Date().toISOString(),
      })
      .eq("id", it.id);
    setHours("");
    setPlayed(false);
    setDried(false);
    setOpen(false);
    setBusy(false);
    await onChanged();
  }

  async function markWashed() {
    setBusy(true);
    await supabase
      .from("bf_footwear")
      .update({
        worn_hours: 0,
        played_count: 0,
        dried_count: 0,
        last_washed_at: new Date().toISOString(),
      })
      .eq("id", it.id);
    setBusy(false);
    await onChanged();
  }

  async function markBare() {
    setBusy(true);
    await supabase
      .from("bf_footwear")
      .update({
        sockless_count: socklessCount + 1,
        last_worn_at: new Date().toISOString(),
      })
      .eq("id", it.id);
    setBusy(false);
    await onChanged();
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex gap-4">
        {url ? (
          <button
            type="button"
            onClick={() => onView(url)}
            aria-label={`View ${it.name} larger`}
            className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-neutral-100 transition-opacity hover:opacity-90 dark:bg-neutral-900"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={it.name} className="h-full w-full object-cover" />
          </button>
        ) : (
          <div className="h-24 w-24 shrink-0 rounded-lg bg-neutral-100 dark:bg-neutral-900" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{it.name}</p>
          <p className="text-xs capitalize text-neutral-500">
            {prettyCategory(it.category)}
            {it.colour ? ` · ${it.colour}` : ""}
          </p>
          {it.dossier?.summary && (
            <p className="mt-1 text-xs italic text-neutral-500">
              {it.dossier.summary}
            </p>
          )}
          <p className="mt-1 text-xs text-neutral-400">
            {wearBits.length ? wearBits.join(" · ") : "Fresh / clean"}
          </p>
        </div>
        <button
          onClick={onDelete}
          className="self-start text-xs text-neutral-400 hover:text-red-500"
        >
          Remove
        </button>
      </div>

      {/* Controls */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {isSock ? (
          <>
            <button
              onClick={() => setOpen((v) => !v)}
              className="font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              {open ? "Close" : "Log wear"}
            </button>
            <button
              onClick={markWashed}
              disabled={busy}
              className="text-neutral-500 hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
            >
              Mark washed
            </button>
          </>
        ) : (
          <button
            onClick={markBare}
            disabled={busy}
            className="font-medium text-neutral-500 hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
          >
            Worn bare once
          </button>
        )}
        <button
          onClick={startEdit}
          className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          Edit
        </button>
        {it.photo_path && (
          <button
            onClick={onReprofile}
            className="text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Re-profile
          </button>
        )}
      </div>

      {/* Edit details */}
      {editing && (
        <div className="mt-3 space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <input
            value={eName}
            onChange={(e) => setEName(e.target.value)}
            placeholder="Name"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              value={eCategory}
              onChange={(e) => setECategory(e.target.value)}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm capitalize outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
            >
              {FOOTWEAR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {prettyCategory(c)}
                </option>
              ))}
            </select>
            <input
              value={eColour}
              onChange={(e) => setEColour(e.target.value)}
              placeholder="Colour (optional)"
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
            />
          </div>
          <input
            value={eNotes}
            onChange={(e) => setENotes(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
          />
          <label className="block text-xs text-neutral-500">
            Replace photo (optional — re-profiles it)
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setEPhoto(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm text-neutral-500 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm dark:file:bg-neutral-800"
            />
          </label>
          {editErr && <p className="text-xs text-red-500">{editErr}</p>}
          <div className="flex gap-2">
            <button
              onClick={saveEdit}
              disabled={busy}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isSock && open && (
        <div className="mt-3 space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <label className="block text-xs text-neutral-500">
            Roughly how many hours did you wear them?
            <input
              type="number"
              min={0}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="e.g. 4"
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
            />
          </label>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={played}
                onChange={(e) => setPlayed(e.target.checked)}
                className="h-3.5 w-3.5 accent-neutral-900 dark:accent-white"
              />
              Played sport in them
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={dried}
                onChange={(e) => setDried(e.target.checked)}
                className="h-3.5 w-3.5 accent-neutral-900 dark:accent-white"
              />
              Got wet then dried out
            </label>
          </div>
          <button
            onClick={logWear}
            disabled={busy}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {busy ? "Saving…" : "Save wear"}
          </button>
        </div>
      )}
    </div>
  );
}
