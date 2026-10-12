"use client";

import { useEffect, useRef } from "react";
import type { StoryBeat } from "@/lib/clash";

type Props = {
  beats: StoryBeat[];
};

export function Storyboard({ beats }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [beats.length]);

  return (
    <div className="flex h-full min-h-0 flex-col border-2 border-[var(--ink)]/20 bg-[var(--ink)] text-[var(--paper)]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <h2 className="font-[family-name:var(--font-display)] text-sm font-bold uppercase tracking-[0.2em]">
          Storyboard
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-white/40">
          AI decides · unique wins
        </span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {beats.length === 0 && (
          <p className="text-sm text-white/40">
            The ring is quiet. Forge both agents to start the clash.
          </p>
        )}
        {beats.map((b) => (
          <article
            key={b.id}
            className="story-in border-l-2 border-[var(--brass)] pl-3"
          >
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-white/45">
              <span>
                {b.player === "system" ? "Ring" : `Char ${b.player}`}
              </span>
              {b.action && b.action !== "forge" && (
                <span className="text-[var(--brass)]">{b.action}</span>
              )}
              {typeof b.damage === "number" && b.damage > 0 && (
                <span className="text-[var(--flash)]">−{b.damage} HP</span>
              )}
              {b.blocked && <span className="text-sky-300">blocked</span>}
              {typeof b.effectMs === "number" && b.effectMs > 0 && (
                <span>{(b.effectMs / 1000).toFixed(1)}s effect</span>
              )}
              {typeof b.uniqueness === "number" && (
                <span
                  className={
                    b.uniqueness < 30
                      ? "text-white/35"
                      : b.uniqueness > 70
                        ? "text-[var(--flash)]"
                        : undefined
                  }
                >
                  uniq {b.uniqueness}
                </span>
              )}
              {typeof b.speedBonus === "number" && b.speedBonus > 0 && (
                <span>+{b.speedBonus} speed</span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-[var(--paper)]/95">
              {b.text}
            </p>
          </article>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
