"use client";

import { MAX_HP } from "@/lib/clash";

type Props = {
  hp: number;
  side: "teal" | "coral";
  label: string;
};

export function HPBar({ hp, side, label }: Props) {
  const pct = Math.max(0, Math.min(100, (hp / MAX_HP) * 100));
  const fill = side === "teal" ? "bg-[var(--teal)]" : "bg-[var(--coral)]";
  const track =
    side === "teal" ? "from-teal-900/10" : "from-orange-900/10";

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-end justify-between gap-2">
        <span className="font-[family-name:var(--font-display)] text-sm font-bold tracking-wide uppercase">
          {label}
        </span>
        <span className="text-xs tabular-nums text-[var(--mute)]">
          {Math.max(0, Math.round(hp))}/{MAX_HP}
        </span>
      </div>
      <div
        className={`h-3 overflow-hidden rounded-sm bg-gradient-to-r ${track} to-black/10 ring-1 ring-[var(--ink)]/15`}
      >
        <div
          className={`h-full ${fill} transition-[width] duration-500 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
