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

    // First run: an existing session with no stored marker starts its window now.
    if (!localStorage.getItem(KEY)) touch();
    if (expired()) {
      lock();
      return;
    }

    // A genuine fresh sign-in (not a reload) resets the window.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") touch();
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
