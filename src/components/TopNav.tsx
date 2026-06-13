"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/chronicle", label: "Chronicle" },
  { href: "/roll", label: "Roll" },
  { href: "/catalogue", label: "Catalogue" },
  { href: "/feet", label: "Feet" },
  { href: "/archive", label: "Archive" },
  { href: "/stats", label: "Stats" },
  { href: "/reports", label: "Reports" },
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
    <nav className="sticky top-0 z-40 hidden border-b border-line bg-surface/80 backdrop-blur sm:block">
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
                  ? "bg-accent text-on-accent"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
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
