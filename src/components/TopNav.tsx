"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/roll", label: "Roll" },
  { href: "/catalogue", label: "Catalogue" },
  { href: "/feet", label: "Feet" },
  { href: "/gallery", label: "The file" },
  { href: "/archive", label: "Archive" },
  { href: "/stats", label: "Stats" },
  { href: "/settings", label: "Settings" },
];

// Hide the nav on the auth/gate screens — there's nothing to navigate to there.
const HIDDEN_PREFIXES = ["/login", "/mfa", "/auth"];

export function TopNav() {
  const pathname = usePathname() || "/";
  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return null;
  }

  return (
    <nav className="sticky top-0 z-40 border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
      <div className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 py-2">
        {LINKS.map((l) => {
          const active =
            l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
