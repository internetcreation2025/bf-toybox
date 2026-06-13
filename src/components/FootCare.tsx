"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resizeImage } from "@/lib/image";

// A single podiatry action the DECIDER asks for — e.g. "trim right big toenail",
// "file hard skin on left heel". She decides when care is warranted (Mike can't
// set these himself). Each keeps a before and an after photo so progress is
// visible, and she compares the two and confirms it's done properly.
type CareRow = {
  id: string;
  area: string;
  action: string;
  before_path: string | null;
  after_path: string | null;
  assessment: string | null;
  done: boolean | null;
  created_at: string;
};

export function FootCare() {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<CareRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [tableReady, setTableReady] = useState(true);
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<string>("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data, error: selErr } = await supabase
      .from("bf_foot_care")
      .select("*")
      .order("created_at", { ascending: false });
    if (selErr) {
      setTableReady(false);
      return;
    }
    const list = (data ?? []) as CareRow[];
    setRows(list);

    const signed: Record<string, string> = {};
    for (const r of list) {
      for (const p of [r.before_path, r.after_path]) {
        if (p) {
          const { data: s } = await supabase.storage
            .from("bf-feet")
            .createSignedUrl(p, 3600);
          if (s?.signedUrl) signed[p] = s.signedUrl;
        }
      }
    }
    setUrls(signed);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function askDeciderToCheck() {
    setChecking(true);
    setError("");
    setVerdict("");
    try {
      const res = await fetch("/api/feet/care-request", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Couldn't ask the Decider");
      setVerdict(
        json.needed
          ? `${json.message ? json.message + " " : ""}She's set a task: ${json.area} — ${json.action}.`
          : json.message || "Your feet look well kept — nothing to do right now."
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't ask the Decider");
    } finally {
      setChecking(false);
    }
  }

  if (!tableReady) {
    return (
      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Foot care
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          Run the foot-care SQL to switch this on — then the Decider can set
          care tasks (trim, file, etc.) with before/after photos.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Foot care
        </h2>
        <button
          type="button"
          onClick={askDeciderToCheck}
          disabled={checking}
          className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {checking ? "She's looking…" : "Ask the Decider to check my feet"}
        </button>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Care is the Decider&apos;s call. She looks over your feet and, only if
        something genuinely needs doing — a nail, hard skin, dryness — she sets
        the task. Add a before and an after photo, and she&apos;ll confirm it was
        done properly.
      </p>

      {verdict && (
        <p className="mt-3 rounded-lg bg-neutral-50 p-3 text-sm italic leading-relaxed text-neutral-700 dark:bg-neutral-950 dark:text-neutral-200">
          {verdict}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

      <div className="mt-4 space-y-3">
        {rows.length === 0 && (
          <p className="text-sm text-neutral-400">
            No care tasks. The Decider hasn&apos;t asked for anything — tap above
            to have her check.
          </p>
        )}
        {rows.map((r) => (
          <CareCard
            key={r.id}
            row={r}
            userId={userId}
            urls={urls}
            onChanged={load}
          />
        ))}
      </div>
    </section>
  );
}

function CareCard({
  row,
  userId,
  urls,
  onChanged,
}: {
  row: CareRow;
  userId: string | null;
  urls: Record<string, string>;
  onChanged: () => Promise<void>;
}) {
  const supabase = createClient();
  const [busy, setBusy] = useState<"before" | "after" | "review" | "done" | null>(
    null
  );
  const beforeRef = useRef<HTMLInputElement>(null);
  const afterRef = useRef<HTMLInputElement>(null);

  async function uploadShot(which: "before" | "after", file: File) {
    if (!userId) return;
    setBusy(which);
    try {
      const blob = await resizeImage(file);
      const path = `${userId}/care/${row.id}/${which}.jpg`;
      await supabase.storage
        .from("bf-feet")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      await supabase
        .from("bf_foot_care")
        .update({ [`${which}_path`]: path })
        .eq("id", row.id);
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function review() {
    setBusy("review");
    try {
      const res = await fetch("/api/feet/care-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const json = await res.json();
      if (res.ok && json.assessment) await onChanged();
      else if (json.error) alert(json.error);
    } finally {
      setBusy(null);
    }
  }

  async function toggleDone() {
    setBusy("done");
    await supabase
      .from("bf_foot_care")
      .update({ done: !row.done })
      .eq("id", row.id);
    setBusy(null);
    await onChanged();
  }

  async function remove() {
    if (!confirm("Remove this care task?")) return;
    for (const p of [row.before_path, row.after_path]) {
      if (p) await supabase.storage.from("bf-feet").remove([p]);
    }
    await supabase.from("bf_foot_care").delete().eq("id", row.id);
    await onChanged();
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {row.area}
            {row.done && (
              <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-950/50 dark:text-green-400">
                Done
              </span>
            )}
          </p>
          <p className="text-sm text-neutral-500">{row.action}</p>
        </div>
        <button
          onClick={remove}
          className="shrink-0 text-xs text-neutral-400 hover:text-red-500"
        >
          Remove
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {(["before", "after"] as const).map((which) => {
          const path = which === "before" ? row.before_path : row.after_path;
          const ref = which === "before" ? beforeRef : afterRef;
          return (
            <div key={which}>
              <p className="mb-1 text-xs font-medium capitalize text-neutral-500">
                {which}
              </p>
              <button
                type="button"
                onClick={() => ref.current?.click()}
                disabled={busy === which}
                className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-xs text-neutral-400 hover:border-neutral-400 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-950"
              >
                {busy === which ? (
                  "Uploading…"
                ) : path && urls[path] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={urls[path]}
                    alt={which}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  `+ ${which} photo`
                )}
              </button>
              <input
                ref={ref}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadShot(which, f);
                  e.target.value = "";
                }}
              />
            </div>
          );
        })}
      </div>

      {row.assessment && (
        <p className="mt-3 whitespace-pre-line rounded-lg bg-neutral-50 p-3 text-xs italic leading-relaxed text-neutral-600 dark:bg-neutral-950 dark:text-neutral-300">
          {row.assessment}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <button
          onClick={review}
          disabled={busy === "review" || !row.before_path || !row.after_path}
          title={
            !row.before_path || !row.after_path
              ? "Add both a before and an after photo first"
              : "Ask the Decider to compare before and after"
          }
          className="font-medium text-neutral-500 hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
        >
          {busy === "review" ? "Checking…" : "Decider, check it"}
        </button>
        <button
          onClick={toggleDone}
          disabled={busy === "done"}
          className="text-neutral-500 hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
        >
          {row.done ? "Reopen" : "Mark done"}
        </button>
      </div>
    </div>
  );
}
