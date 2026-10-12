"use client";

import { MAX_CHARS, REGEN_CHARS, REGEN_MS } from "@/lib/clash";

type Props = {
  budget: number;
  used: number;
  nextRegenIn: number;
};

export function CharBudget({ budget, used, nextRegenIn }: Props) {
  const remaining = Math.max(0, budget - used);
  const secs = Math.ceil(nextRegenIn / 1000);

  return (
    <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-wider text-[var(--mute)]">
      <span>
        Budget{" "}
        <span
          className={`font-semibold tabular-nums ${
            remaining < 20 ? "text-[var(--coral)]" : "text-[var(--ink)]"
          }`}
        >
          {remaining}
        </span>
        /{budget}
      </span>
      <span className="tabular-nums">
        +{REGEN_CHARS} in {secs}s
        <span className="ml-1 opacity-50">(cap {MAX_CHARS})</span>
      </span>
      <span className="sr-only">{REGEN_MS}</span>
    </div>
  );
}
