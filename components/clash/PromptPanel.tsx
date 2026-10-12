"use client";

import { useEffect, useState } from "react";
import type { PlayerId } from "@/lib/clash";
import { CharBudget } from "./CharBudget";

type Props = {
  player: PlayerId;
  budget: number;
  nextRegenIn: number;
  disabled: boolean;
  busy: boolean;
  forged: boolean;
  onSubmit: (prompt: string) => void;
};

export function PromptPanel({
  player,
  budget,
  nextRegenIn,
  disabled,
  busy,
  forged,
  onSubmit,
}: Props) {
  const [text, setText] = useState("");
  const side = player === 1 ? "teal" : "coral";
  const accent =
    side === "teal" ? "border-[var(--teal)]" : "border-[var(--coral)]";
  const btn =
    side === "teal"
      ? "bg-[var(--teal)] hover:bg-[var(--teal-hot)]"
      : "bg-[var(--coral)] hover:bg-[var(--coral-hot)]";

  const used = text.length;
  const over = used > budget;

  useEffect(() => {
    if (!busy) return;
  }, [busy]);

  function send() {
    const trimmed = text.trim();
    if (!trimmed || over || disabled || busy) return;
    onSubmit(trimmed);
    setText("");
  }

  return (
    <div
      className={`flex h-full flex-col border-2 bg-[var(--ring)]/80 p-3 backdrop-blur-sm ${accent}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-extrabold uppercase tracking-tight">
          Char {player}
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-[var(--mute)]">
          {forged ? "Battle prompt" : "Forge agent"}
        </span>
      </div>

      <CharBudget budget={budget} used={used} nextRegenIn={nextRegenIn} />

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, Math.max(budget, 0)))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        disabled={disabled || busy}
        placeholder={
          forged
            ? "Attack, defend, fly, spawn a gun, throw bubbles — anything…"
            : "Forge something weird & specific — generics hit soft…"
        }
        className="mt-2 min-h-[110px] flex-1 resize-none border border-[var(--ink)]/15 bg-[var(--paper)] p-3 text-sm leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--mute)]/70 focus:border-[var(--ink)]/40 disabled:opacity-50"
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={`text-xs tabular-nums ${
            over ? "text-[var(--coral)]" : "text-[var(--mute)]"
          }`}
        >
          {used}/{budget} chars
        </span>
        <button
          type="button"
          onClick={send}
          disabled={disabled || busy || !text.trim() || over}
          className={`px-4 py-2 font-[family-name:var(--font-display)] text-sm font-bold uppercase tracking-wide text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${btn}`}
        >
          {busy ? "Resolving…" : forged ? "Strike" : "Forge"}
        </button>
      </div>
    </div>
  );
}
