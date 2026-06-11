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
    </main>
  );
}
