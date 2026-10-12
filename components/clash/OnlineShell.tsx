"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isBlocking, type AnimSpec, type PlayerId } from "@/lib/clash";
import type { RoomSnapshot } from "@/lib/clash-room";
import { Arena } from "./Arena";
import { HPBar } from "./HPBar";
import { PromptPanel } from "./PromptPanel";
import { Storyboard } from "./Storyboard";

type Props = {
  /** If set, join this room instead of hosting */
  joinCode?: string | null;
  onBack: () => void;
};

function playerToken() {
  const key = "clash-player-token";
  let t = sessionStorage.getItem(key);
  if (!t) {
    t = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    sessionStorage.setItem(key, t);
  }
  return t;
}

async function roomApi(body: Record<string, unknown>) {
  const res = await fetch("/api/room", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok && data.ok !== false, status: res.status, data };
}

export function OnlineShell({ joinCode, onBack }: Props) {
  const [token] = useState(() =>
    typeof window !== "undefined" ? playerToken() : ""
  );
  const [seat, setSeat] = useState<PlayerId | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);
  const codeRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setError(null);
      const want = (joinCode || "").trim().toUpperCase();
      try {
        if (want) {
          const { ok, data } = await roomApi({
            action: "join",
            code: want,
            token,
          });
          if (cancelled) return;
          if (!ok || !data.seat || !data.state) {
            setError(data.error || "Failed to join room");
            setBooting(false);
            return;
          }
          codeRef.current = data.state.code;
          setSeat(data.seat);
          setRoom(data.state);
        } else {
          const { ok, data } = await roomApi({ action: "create", token });
          if (cancelled) return;
          if (!ok || !data.seat || !data.state) {
            setError(data.error || "Failed to host room");
            setBooting(false);
            return;
          }
          codeRef.current = data.state.code;
          setSeat(data.seat);
          setRoom(data.state);
          const url = new URL(window.location.href);
          url.searchParams.set("room", data.state.code);
          window.history.replaceState({}, "", url.toString());
        }
      } catch {
        if (!cancelled) setError("Could not reach room server");
      } finally {
        if (!cancelled) setBooting(false);
      }
    }

    if (token) boot();
    return () => {
      cancelled = true;
    };
  }, [joinCode, token]);

  // Poll room state
  useEffect(() => {
    if (!codeRef.current && !room?.code) return;
    const code = codeRef.current || room?.code;
    if (!code) return;

    const id = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/room?code=${encodeURIComponent(code)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.state) setRoom(data.state);
      } catch {
        // ignore transient poll errors
      }
    }, 700);

    return () => window.clearInterval(id);
  }, [room?.code, booting]);

  useEffect(() => {
    if (room?.phase !== "live") return;
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [room?.phase]);

  useEffect(() => {
    return () => {
      const code = codeRef.current;
      if (!code || !token) return;
      void roomApi({ action: "leave", code, token });
    };
  }, [token]);

  const myBudget = seat === 1 ? room?.budget1 ?? 0 : room?.budget2 ?? 0;
  const myRegen = seat === 1 ? room?.regen1 ?? 0 : room?.regen2 ?? 0;

  const shareUrl =
    typeof window !== "undefined" && room
      ? `${window.location.origin}/?room=${room.code}`
      : "";

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy link");
    }
  }

  async function startMatch() {
    if (!room) return;
    setError(null);
    const { ok, data } = await roomApi({
      action: "start",
      code: room.code,
      token,
    });
    if (!ok) setError(data.error || "Could not start");
    else if (data.state) setRoom(data.state);
  }

  async function rematch() {
    if (!room) return;
    setError(null);
    const { ok, data } = await roomApi({
      action: "rematch",
      code: room.code,
      token,
    });
    if (!ok) setError(data.error || "Could not rematch");
    else if (data.state) setRoom(data.state);
  }

  async function submit(prompt: string) {
    if (!room) return;
    setError(null);
    const { ok, data } = await roomApi({
      action: "prompt",
      code: room.code,
      token,
      prompt,
    });
    if (!ok) setError(data.error || "Prompt failed");
    else if (data.state) setRoom(data.state);
  }

  const fxAnim: AnimSpec | null = room?.fx.anim ?? null;
  const waiting = !room || room.phase === "waiting";

  const blockLeft = useMemo(() => {
    if (!room) return { a: 0, b: 0 };
    return {
      a: isBlocking(room.status1)
        ? Math.max(0, (room.status1.blockUntil - Date.now()) / 1000)
        : 0,
      b: isBlocking(room.status2)
        ? Math.max(0, (room.status2.blockUntil - Date.now()) / 1000)
        : 0,
    };
  }, [room, room?.status1.blockUntil, room?.status2.blockUntil]);

  if (booting) {
    return (
      <div className="relative flex h-[100dvh] items-center justify-center arena-floor">
        <p className="text-sm uppercase tracking-widest text-[var(--mute)]">
          Opening room…
        </p>
      </div>
    );
  }

  if (waiting) {
    return (
      <div className="relative flex h-[100dvh] flex-col overflow-hidden arena-floor">
        <div className="noise-overlay absolute inset-0" />
        <main className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 py-10">
          <button
            type="button"
            onClick={onBack}
            className="mb-6 w-fit text-xs uppercase tracking-widest text-[var(--mute)] hover:text-[var(--ink)]"
          >
            ← Back
          </button>
          <h1 className="font-[family-name:var(--font-display)] text-4xl font-extrabold tracking-tighter uppercase">
            {seat === 1 ? "Your room" : "Joined"}
          </h1>
          <p className="mt-3 text-sm text-[var(--ink)]/75">
            {seat === 1
              ? "Share the link with a friend. When they join, start the match."
              : "Waiting for the host to start the match."}
          </p>

          {room && (
            <div className="mt-8 border-2 border-[var(--ink)]/15 bg-[var(--paper)]/90 p-4">
              <p className="text-xs uppercase tracking-widest text-[var(--mute)]">
                Room code
              </p>
              <p className="font-[family-name:var(--font-display)] text-5xl font-extrabold tracking-[0.2em]">
                {room.code}
              </p>
              <p className="mt-3 text-sm text-[var(--ink)]/70">
                You are <strong>Char {seat}</strong>.
              </p>
              {seat === 1 && shareUrl && (
                <div className="mt-4 flex flex-col gap-2">
                  <code className="break-all rounded bg-[var(--ink)]/10 px-2 py-1.5 text-xs">
                    {shareUrl}
                  </code>
                  <button
                    type="button"
                    onClick={copyLink}
                    className="w-fit bg-[var(--ink)] px-4 py-2 text-xs font-bold uppercase text-[var(--paper)]"
                  >
                    {copied ? "Copied" : "Copy invite link"}
                  </button>
                </div>
              )}
              <div className="mt-4 flex gap-4 text-xs uppercase tracking-wider">
                <span
                  className={
                    room.seats[1] ? "text-[var(--teal)]" : "text-[var(--mute)]"
                  }
                >
                  Char 1 {room.seats[1] ? "ready" : "…"}
                </span>
                <span
                  className={
                    room.seats[2] ? "text-[var(--coral)]" : "text-[var(--mute)]"
                  }
                >
                  Char 2 {room.seats[2] ? "ready" : "waiting"}
                </span>
              </div>
              {seat === 1 && (
                <button
                  type="button"
                  disabled={!room.seats[1] || !room.seats[2]}
                  onClick={startMatch}
                  className="mt-5 bg-[var(--teal)] px-5 py-2.5 font-[family-name:var(--font-display)] font-bold uppercase text-white disabled:opacity-40"
                >
                  Start match
                </button>
              )}
              {seat === 2 && (
                <p className="mt-4 text-sm text-[var(--mute)]">
                  Waiting for host to start…
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="mt-4 text-sm text-[var(--coral)]">{error}</p>
          )}
        </main>
      </div>
    );
  }

  if (!room || !seat) {
    return (
      <div className="relative flex h-[100dvh] flex-col items-center justify-center gap-4 arena-floor px-6">
        <p className="text-sm text-[var(--coral)]">{error || "Room unavailable"}</p>
        <button
          type="button"
          onClick={onBack}
          className="text-xs uppercase tracking-widest text-[var(--mute)]"
        >
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-[var(--dust)]">
      <header className="flex shrink-0 items-center justify-between border-b-2 border-[var(--ink)]/15 bg-[var(--paper)] px-4 py-2.5">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-extrabold tracking-tighter uppercase">
            Clash · {room.code}
          </h1>
          <p className="text-[10px] uppercase tracking-widest text-[var(--mute)]">
            You are Char {seat}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {room.phase === "over" && seat === 1 && (
            <button
              type="button"
              onClick={rematch}
              className="bg-[var(--ink)] px-3 py-1.5 text-xs font-bold uppercase text-[var(--paper)]"
            >
              Rematch
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            className="text-xs uppercase tracking-widest text-[var(--mute)]"
          >
            Leave
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] lg:grid-cols-[minmax(240px,1fr)_minmax(320px,1.4fr)_minmax(240px,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]">
        <div className="col-span-full flex gap-4 border-b border-[var(--ink)]/10 bg-[var(--paper)]/90 px-4 py-3 lg:col-span-3">
          <div className="flex-1">
            <HPBar
              hp={room.hp1}
              side="teal"
              label={room.agent1.forged ? room.agent1.name : "Char 1"}
            />
            {blockLeft.a > 0 && (
              <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--teal)]">
                Blocking {blockLeft.a.toFixed(1)}s
              </p>
            )}
          </div>
          <div className="flex-1">
            <HPBar
              hp={room.hp2}
              side="coral"
              label={room.agent2.forged ? room.agent2.name : "Char 2"}
            />
            {blockLeft.b > 0 && (
              <p className="mt-1 text-right text-[10px] uppercase tracking-wider text-[var(--coral)]">
                Blocking {blockLeft.b.toFixed(1)}s
              </p>
            )}
          </div>
        </div>

        <div className="min-h-0 border-b border-[var(--ink)]/10 p-2 lg:order-1 lg:border-b-0 lg:border-r">
          <PromptPanel
            player={1}
            budget={seat === 1 ? myBudget : room.budget1}
            nextRegenIn={seat === 1 ? myRegen : room.regen1}
            disabled={room.phase === "over" || seat !== 1}
            busy={!!room.busy1}
            forged={room.agent1.forged}
            onSubmit={submit}
          />
          {seat !== 1 && (
            <p className="mt-1 text-center text-[10px] uppercase tracking-wider text-[var(--mute)]">
              Opponent panel
            </p>
          )}
        </div>

        <div className="flex min-h-0 flex-col lg:order-2">
          <div className="min-h-[240px] flex-1 border-b border-[var(--ink)]/10 lg:min-h-0 lg:flex-[1.15]">
            <Arena
              agent1={room.agent1}
              agent2={room.agent2}
              hp1={room.hp1}
              hp2={room.hp2}
              actor={room.fx.actor}
              anim={fxAnim}
              hitKey={room.fx.hitKey}
              lastDamage={room.fx.damage}
              oppActor={room.fx.oppActor ?? null}
              oppAnim={room.fx.oppAnim ?? null}
              oppHitKey={room.fx.oppHitKey ?? 0}
              oppDamage={room.fx.oppDamage ?? 0}
              blocking1={isBlocking(room.status1)}
              blocking2={isBlocking(room.status2)}
              flash={room.fx.flash}
              winner={room.winner}
            />
          </div>
          <div className="h-44 shrink-0 lg:h-auto lg:min-h-[180px] lg:flex-1">
            <Storyboard beats={room.beats} />
          </div>
        </div>

        <div className="min-h-0 border-t border-[var(--ink)]/10 p-2 lg:order-3 lg:border-t-0 lg:border-l">
          <PromptPanel
            player={2}
            budget={seat === 2 ? myBudget : room.budget2}
            nextRegenIn={seat === 2 ? myRegen : room.regen2}
            disabled={room.phase === "over" || seat !== 2}
            busy={!!room.busy2}
            forged={room.agent2.forged}
            onSubmit={submit}
          />
          {seat !== 2 && (
            <p className="mt-1 text-center text-[10px] uppercase tracking-wider text-[var(--mute)]">
              Opponent panel
            </p>
          )}
        </div>
      </div>

      {error && (
        <p className="border-t border-[var(--coral)]/30 bg-[var(--paper)] px-4 py-1 text-xs text-[var(--coral)]">
          {error}
        </p>
      )}
    </div>
  );
}
