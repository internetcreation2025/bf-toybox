import { RARITY_META, type Rarity } from "@/lib/decider";

export type ElementCheck = { name: string; present: boolean };
export type Verification = {
  is_owner_feet: boolean;
  match_confidence: number;
  required_elements: ElementCheck[];
  verdict: "pass" | "fail";
  reasoning: string;
};

// A "forensic" report card showing the verdict on a proof photo: foot-match
// confidence, the element checklist, and the examiner's reasoning.
export function ForensicCard({
  verification,
  proofUrl,
  rarity,
  instruction,
}: {
  verification: Verification;
  proofUrl?: string;
  rarity?: Rarity;
  instruction?: string;
}) {
  const passed = verification.verdict === "pass";
  const accent = passed ? "#16a34a" : "#dc2626";
  const rarityMeta = rarity ? RARITY_META[rarity] : null;

  return (
    <div
      className="overflow-hidden rounded-2xl border-2 shadow-lg"
      style={{ borderColor: accent }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ backgroundColor: accent }}
      >
        <span className="text-sm font-semibold uppercase tracking-widest text-white">
          {passed ? "Verified" : "Failed"}
        </span>
        <span className="font-mono text-xs uppercase tracking-wider text-white/80">
          Forensic report
        </span>
      </div>

      <div className="space-y-5 p-5">
        {rarityMeta && (
          <span
            className="inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white"
            style={{ backgroundColor: rarityMeta.colour }}
          >
            {rarityMeta.label} dare
          </span>
        )}

        {instruction && (
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            {instruction}
          </p>
        )}

        {proofUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proofUrl}
            alt="Submitted proof"
            className="max-h-72 w-full rounded-xl object-cover"
          />
        )}

        {/* Foot match */}
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Foot match</span>
            <span className="font-mono">
              {verification.is_owner_feet ? "Owner's feet" : "Not recognised"} ·{" "}
              {verification.match_confidence}%
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${verification.match_confidence}%`,
                backgroundColor: verification.is_owner_feet ? "#16a34a" : "#dc2626",
              }}
            />
          </div>
        </div>

        {/* Required elements */}
        {verification.required_elements.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Required elements
            </p>
            <ul className="mt-2 space-y-1.5">
              {verification.required_elements.map((el, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span
                    aria-hidden
                    className={
                      el.present ? "text-green-600" : "text-red-500"
                    }
                  >
                    {el.present ? "✓" : "✗"}
                  </span>
                  <span
                    className={
                      el.present
                        ? "text-neutral-700 dark:text-neutral-200"
                        : "text-muted line-through"
                    }
                  >
                    {el.name}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Reasoning */}
        {verification.reasoning && (
          <div className="rounded-xl bg-neutral-50 p-4 dark:bg-neutral-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Examiner's notes
            </p>
            <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300">
              {verification.reasoning}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
