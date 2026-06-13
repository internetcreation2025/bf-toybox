"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Phone-first bottom tab bar (mobile only — desktop keeps the TopNav). Five
// thumb-reachable destinations; everything else lives behind "More".
const TABS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/roll?plan=1", label: "Set", icon: RollIcon },
  { href: "/feet", label: "Feet", icon: FootIcon },
  { href: "/catalogue", label: "Wardrobe", icon: ShoeIcon },
  { href: "/more", label: "More", icon: MoreIcon },
];

const HIDDEN_PREFIXES = ["/login", "/mfa", "/auth"];

export function BottomNav() {
  const pathname = usePathname() || "/";
  if (
    HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return null;
  }

  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 backdrop-blur sm:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-around">
        {TABS.map((t) => {
          const base = t.href.split("?")[0];
          const active =
            base === "/" ? pathname === "/" : pathname.startsWith(base);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                active ? "text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              <Icon active={active} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

type IconProps = { active?: boolean };
const base = (active?: boolean) => ({
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: active ? 2.1 : 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

function HomeIcon({ active }: IconProps) {
  return (
    <svg {...base(active)} aria-hidden>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

function RollIcon({ active }: IconProps) {
  return (
    <svg {...base(active)} aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FootIcon({ active }: IconProps) {
  return (
    <svg {...base(active)} aria-hidden>
      <path d="M8.5 14.5c-.4-2-.6-4.2-.4-6.2C8.3 5.7 9.4 4 11 4c1.7 0 2.3 1.8 2.4 3.8.1 1.8-.2 3.6.3 4.9.4 1 1.5 1.6 1.8 2.7.4 1.4-.5 2.6-2 2.6-1.2 0-1.8-.7-2.5-1.4-.6-.6-1.3-1-2-1-1.3 0-2.2-.4-2.5-1.6Z" />
      <circle cx="15.5" cy="6.5" r="1" />
      <circle cx="17" cy="9" r=".9" />
      <circle cx="17.5" cy="11.5" r=".8" />
    </svg>
  );
}

function ShoeIcon({ active }: IconProps) {
  return (
    <svg {...base(active)} aria-hidden>
      <path d="M2.5 16h17a2 2 0 0 0 1.9-2.6c-.4-1.3-1.6-2-3-2.4l-3.5-1c-.7-.2-1.3-.6-1.8-1.2L11.4 6c-.4-.5-1-.8-1.6-.8H4a1 1 0 0 0-1 1v9Z" />
      <path d="M3 12.5h3.5" />
      <path d="M9 8.5l1.5 2" />
    </svg>
  );
}

function MoreIcon({ active }: IconProps) {
  return (
    <svg {...base(active)} aria-hidden>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
