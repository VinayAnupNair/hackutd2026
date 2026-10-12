"use client";

import dynamic from "next/dynamic";
import type { Agent, AnimSpec, PlayerId } from "@/lib/clash";

const ArenaScene = dynamic(
  () => import("./ArenaScene").then((m) => m.ArenaScene),
  { ssr: false }
);

type Props = {
  agent1: Agent;
  agent2: Agent;
  hp1: number;
  hp2: number;
  actor: PlayerId | null;
  anim: AnimSpec | null;
  hitKey: number;
  lastDamage: number;
  oppActor?: PlayerId | null;
  oppAnim?: AnimSpec | null;
  oppHitKey?: number;
  oppDamage?: number;
  blocking1: boolean;
  blocking2: boolean;
  flash: string | null;
  winner: 1 | 2 | null;
};

export function Arena({
  agent1,
  agent2,
  actor,
  anim,
  hitKey,
  lastDamage,
  oppActor = null,
  oppAnim = null,
  oppHitKey = 0,
  oppDamage = 0,
  blocking1,
  blocking2,
  flash,
  winner,
}: Props) {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden arena-floor">
      <div className="noise-overlay absolute inset-0 z-[1]" />
      <ArenaScene
        forged1={agent1.forged}
        forged2={agent2.forged}
        actor={actor}
        anim={anim}
        hitKey={hitKey}
        damage={lastDamage}
        oppActor={oppActor}
        oppAnim={oppAnim}
        oppHitKey={oppHitKey}
        oppDamage={oppDamage}
        blocking1={blocking1}
        blocking2={blocking2}
      />

      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-between px-4 md:px-8">
        <div className="max-w-[42%]">
          <p className="font-[family-name:var(--font-display)] text-sm font-extrabold uppercase tracking-tight text-[var(--teal)] md:text-base">
            {agent1.name}
          </p>
          <p className="text-[10px] text-[var(--mute)] md:text-[11px]">
            {agent1.epithet}
          </p>
        </div>
        <div className="max-w-[42%] text-right">
          <p className="font-[family-name:var(--font-display)] text-sm font-extrabold uppercase tracking-tight text-[var(--coral)] md:text-base">
            {agent2.name}
          </p>
          <p className="text-[10px] text-[var(--mute)] md:text-[11px]">
            {agent2.epithet}
          </p>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex flex-col items-center gap-1">
        {flash && (
          <span className="rounded-sm bg-[var(--ink)] px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--flash)]">
            {flash}
            {anim?.style ? ` · ${anim.style}` : ""}
            {lastDamage > 0 ? ` −${lastDamage}` : ""}
          </span>
        )}
        {winner && (
          <span className="font-[family-name:var(--font-display)] text-sm font-extrabold uppercase text-[var(--ink)]">
            Char {winner} wins
          </span>
        )}
        {!winner && !flash && (
          <span className="font-[family-name:var(--font-display)] text-xs font-bold uppercase tracking-[0.25em] text-[var(--ink)]/30">
            Ring
          </span>
        )}
      </div>
    </div>
  );
}
