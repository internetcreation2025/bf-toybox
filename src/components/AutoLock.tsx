"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Inactivity auto-lock: if the app is left open (or closed and reopened) with no
// interaction for this long, sign out so it demands a fresh login + MFA again.
const TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const KEY = "bf-last-activity";
const AUTH_PREFIXES = ["/login", "/mfa", "/auth"];

export function AutoLock() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const onAuthPage = AUTH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  useEffect(() => {
    if (onAuthPage) return;
    const supabase = createClient();

    const touch = () => {
      try {
        localStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    };

    const lock = async () => {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
      await supabase.auth.signOut();
      router.replace("/login");
    };

    const expired = () => {
      const last = Number(localStorage.getItem(KEY) || 0);
      return last > 0 && Date.now() - last > TIMEOUT_MS;
    };

    const check = () => {
      if (expired()) lock();
    };

    // A genuine fresh login (the OAuth callback redirects to /?signedin=1)
    // ALWAYS starts a clean idle window — never judge it against a leftover
    // timestamp from a previous session, or it would lock the user straight
    // back out and the sign-in would loop forever.
    const params = new URLSearchParams(window.location.search);
    const freshLogin = params.get("signedin") === "1";
    if (freshLogin) {
      touch();
      params.delete("signedin");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : "")
      );
    }

    // First run: an existing session with no stored marker starts its window now.
    if (!localStorage.getItem(KEY)) touch();
    if (!freshLogin && expired()) {
      lock();
      return;
    }

    // A genuine fresh sign-in (not a reload) resets the window. OAuth logins may
    // surface as INITIAL_SESSION when the app first loads, so honour both.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") touch();
    });

    const events = ["click", "keydown", "pointerdown", "touchstart", "scroll"];
    events.forEach((e) =>
      window.addEventListener(e, touch, { passive: true })
    );
    const onVis = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVis);
    const interval = window.setInterval(check, 60_000);

    return () => {
      sub.subscription.unsubscribe();
      events.forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(interval);
    };
  }, [onAuthPage, router]);

  return null;
}
