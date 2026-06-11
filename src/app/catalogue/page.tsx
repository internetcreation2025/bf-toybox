"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
        const ext = (photo.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${userId}/footwear/${inserted.id}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("bf-feet")
          .upload(path, photo, { upsert: true, contentType: photo.type });
        if (upErr) throw upErr;
        await supabase
          .from("bf_footwear")
          .update({ photo_path: path })
          .eq("id", inserted.id);
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
        Everything you own — the decision engine picks from this.
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

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.length === 0 && (
          <p className="text-sm text-neutral-400">No footwear yet.</p>
        )}
        {items.map((it) => (
          <div
            key={it.id}
            className="flex gap-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
          >
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-900">
              {urls[it.id] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={urls[it.id]}
                  alt={it.name}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{it.name}</p>
              <p className="text-xs capitalize text-neutral-500">
                {prettyCategory(it.category)}
                {it.colour ? ` · ${it.colour}` : ""}
              </p>
              {it.notes && (
                <p className="mt-1 truncate text-xs text-neutral-400">
                  {it.notes}
                </p>
              )}
            </div>
            <button
              onClick={() => handleDelete(it)}
              className="self-start text-xs text-neutral-400 hover:text-red-500"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
