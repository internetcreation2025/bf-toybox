"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  PERSONAS,
  DEFAULT_PERSONA,
  DEFAULT_BASE_INSTRUCTIONS,
  isPersonaKey,
  type PersonaKey,
} from "@/lib/decider";
import {
  VAPID_PUBLIC_KEY,
  pushSupported,
  currentSubscription,
  subscribe,
  unsubscribe,
} from "@/lib/push-client";

export default function SettingsPage() {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [persona, setPersona] = useState<PersonaKey>(DEFAULT_PERSONA);
  const [base, setBase] = useState(DEFAULT_BASE_INSTRUCTIONS);
  const [custom, setCustom] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data } = await supabase.from("bf_settings").select("*").maybeSingle();
    if (data) {
      if (isPersonaKey(data.persona)) setPersona(data.persona);
      setBase(
        data.base_instructions?.trim()
          ? data.base_instructions
          : DEFAULT_BASE_INSTRUCTIONS
      );
      setCustom(data.custom_instructions ?? "");
    }
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!userId) return;
    setStatus("saving");
    await supabase.from("bf_settings").upsert(
      {
        user_id: userId,
        persona,
        base_instructions: base.trim() || DEFAULT_BASE_INSTRUCTIONS,
        custom_instructions: custom.trim() || null,
      },
      { onConflict: "user_id" }
    );
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link
        href="/"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        The Decider
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        Tune how the game master behaves. Your changes apply to every future roll.
      </p>

      {/* Persona */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold">Voice</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(Object.keys(PERSONAS) as PersonaKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setPersona(k)}
              className={`rounded-xl border p-3 text-left text-sm transition-colors ${
                persona === k
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                  : "border-neutral-300 dark:border-neutral-700"
              }`}
            >
              <span className="font-medium">{PERSONAS[k].label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Base instructions */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Base instructions</h2>
          <button
            onClick={() => setBase(DEFAULT_BASE_INSTRUCTIONS)}
            className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Reset to default
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-400">
          The core brief the Decider always follows. Edit freely.
        </p>
        <textarea
          value={base}
          onChange={(e) => setBase(e.target.value)}
          rows={12}
          className="mt-3 w-full rounded-lg border border-neutral-300 p-3 font-mono text-xs leading-relaxed outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
        />
      </section>

      {/* Custom extra instructions */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold">Your extra instructions</h2>
        <p className="mt-1 text-xs text-neutral-400">
          Added on top of the base, with priority. Use this to add rules or tell
          it to omit things — e.g. &ldquo;never suggest boots&rdquo; or
          &ldquo;skip the date-on-foot requirement&rdquo;.
        </p>
        <textarea
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          rows={5}
          placeholder="Add anything extra here…"
          className="mt-3 w-full rounded-lg border border-neutral-300 p-3 text-sm leading-relaxed outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950"
        />
      </section>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={save}
          disabled={status === "saving"}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        {status === "saved" && (
          <span className="text-sm text-green-600">Saved</span>
        )}
      </div>

      <NotificationsSection />
    </main>
  );
}

function NotificationsSection() {
  const configured = !!VAPID_PUBLIC_KEY;
  const [supported, setSupported] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!pushSupported()) {
      setSupported(false);
      return;
    }
    setSupported(true);
    currentSubscription()
      .then((s) => setEnabled(!!s))
      .catch(() => {});
  }, []);

  async function toggle() {
    setBusy(true);
    setMsg("");
    try {
      if (enabled) {
        await unsubscribe();
        setEnabled(false);
        setMsg("Notifications turned off.");
      } else {
        await subscribe();
        setEnabled(true);
        setMsg("Notifications on for this device.");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Test failed");
      setMsg("Test sent — check your notifications.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-12 border-t border-neutral-200 pt-8 dark:border-neutral-800">
      <h2 className="text-sm font-semibold">Notifications</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Get a quiet, content-free nudge when a sealed mystery envelope is ready
        to open. The alert never shows the verdict — it just tells you to open
        the app.
      </p>

      {supported === false ? (
        <p className="mt-3 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-500 dark:bg-neutral-900">
          This browser can&apos;t do push notifications. On iPhone, add the app
          to your Home Screen and open it from there first.
        </p>
      ) : !configured ? (
        <p className="mt-3 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-500 dark:bg-neutral-900">
          Notifications aren&apos;t switched on by the server yet (the push keys
          still need to be added).
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={toggle}
            disabled={busy}
            className={`rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-50 ${
              enabled
                ? "border border-neutral-300 dark:border-neutral-700"
                : "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
            }`}
          >
            {busy
              ? "Working…"
              : enabled
              ? "Turn off on this device"
              : "Turn on notifications"}
          </button>
          {enabled && (
            <button
              onClick={sendTest}
              disabled={busy}
              className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-medium disabled:opacity-50 dark:border-neutral-700"
            >
              Send test
            </button>
          )}
        </div>
      )}

      {msg && <p className="mt-3 text-sm text-neutral-500">{msg}</p>}
    </section>
  );
}
