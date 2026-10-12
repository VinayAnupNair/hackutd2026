"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OnlineShell } from "./OnlineShell";

function GameShellInner() {
  const search = useSearchParams();
  const router = useRouter();
  const roomParam = (search.get("room") || "").trim().toUpperCase();
  const [hosting, setHosting] = useState(false);

  useEffect(() => {
    if (roomParam) setHosting(false);
  }, [roomParam]);

  function leave() {
    setHosting(false);
    router.replace("/");
  }

  if (roomParam) {
    return <OnlineShell joinCode={roomParam} onBack={leave} />;
  }

  if (hosting) {
    return <OnlineShell onBack={leave} />;
  }

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden arena-floor">
      <div className="noise-overlay absolute inset-0" />
      <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-[var(--teal)]/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-20 h-80 w-80 rounded-full bg-[var(--coral)]/25 blur-3xl" />

      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-10">
        <p className="mb-3 text-xs uppercase tracking-[0.35em] text-[var(--mute)]">
          Prompt duel arena
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-6xl font-extrabold leading-[0.9] tracking-tighter text-[var(--ink)] md:text-8xl">
          Clash
          <br />
          Agents
        </h1>
        <p className="mt-6 max-w-md text-sm leading-relaxed text-[var(--ink)]/75 md:text-base">
          Host a room, share the invite link, and duel with prompts in real
          time.
        </p>
        <div className="mt-10">
          <button
            type="button"
            onClick={() => setHosting(true)}
            className="w-fit bg-[var(--ink)] px-8 py-3.5 font-[family-name:var(--font-display)] text-lg font-bold uppercase tracking-wide text-[var(--paper)] transition hover:bg-[var(--ink)]/90"
          >
            Begin
          </button>
        </div>
      </main>
    </div>
  );
}

export function GameShell() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] items-center justify-center arena-floor">
          <p className="text-sm uppercase tracking-widest text-[var(--mute)]">
            Loading…
          </p>
        </div>
      }
    >
      <GameShellInner />
    </Suspense>
  );
}
