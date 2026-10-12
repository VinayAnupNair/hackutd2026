"use client";

import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  isBlocking,
  type AnimSpec,
  type PlayerId,
} from "@/lib/clash";
import type { RoomSnapshot } from "@/lib/clash-room";
import { Arena } from "./Arena";
import { HPBar } from "./HPBar";
import { PromptPanel } from "./PromptPanel";
import { Storyboard } from "./Storyboard";

type Props = {
  onBack: () => void;
};

export function OnlineShell({ onBack }: Props) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [seat, setSeat] = useState<PlayerId | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lanHint, setLanHint] = useState("");
  const [, setTick] = useState(0);

  useEffect(() => {
    const s = io({ path: "/socket.io", autoConnect: true });
    setSocket(s);
    s.on("room:state", (state: RoomSnapshot) => setRoom(state));
    s.on("connect_error", () =>
      setError("Could not connect — run `npm run dev` (socket server).")
    );
    return () => {
      s.removeAllListeners();
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setLanHint(window.location.host);
  }, []);

  useEffect(() => {
    if (room?.phase !== "live") return;
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [room?.phase]);

  const myBudget = seat === 1 ? room?.budget1 ?? 0 : room?.budget2 ?? 0;
  const myRegen = seat === 1 ? room?.regen1 ?? 0 : room?.regen2 ?? 0;

  function createRoom() {
    setError(null);
    socket?.emit("room:create", (res: { ok: boolean; seat?: PlayerId; state?: RoomSnapshot; error?: string }) => {
      if (!res.ok || !res.seat || !res.state) {
        setError(res.error || "Failed to create room");
        return;
      }
      setSeat(res.seat);
      setRoom(res.state);
    });
  }

  function joinRoom() {
    setError(null);
    socket?.emit(
      "room:join",
      { code: joinCode },
      (res: { ok: boolean; seat?: PlayerId; state?: RoomSnapshot; error?: string }) => {
        if (!res.ok || !res.seat || !res.state) {
          setError(res.error || "Failed to join");
          return;
        }
        setSeat(res.seat);
        setRoom(res.state);
      }
    );
  }

  function startMatch() {
    socket?.emit("room:start", (res: { ok: boolean; error?: string }) => {
      if (!res.ok) setError(res.error || "Could not start");
    });
  }

  function rematch() {
    socket?.emit("room:rematch", (res: { ok: boolean; error?: string }) => {
      if (!res.ok) setError(res.error || "Could not rematch");
    });
  }

  function submit(prompt: string) {
    socket?.emit("prompt:submit", { prompt }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok && res?.error) setError(res.error);
    });
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
            Online clash
          </h1>
          <p className="mt-3 text-sm text-[var(--ink)]/75">
            Host a room on this machine. Friend opens the same site (your LAN
            URL) and joins with the code. Live sync over Socket.io.
          </p>

          {!room && (
            <div className="mt-8 flex flex-col gap-3">
              <button
                type="button"
                onClick={createRoom}
                className="bg-[var(--ink)] px-5 py-3 font-[family-name:var(--font-display)] font-bold uppercase text-[var(--paper)]"
              >
                Host room (Char 1)
              </button>
              <div className="flex gap-2">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="ROOM CODE"
                  maxLength={6}
                  className="flex-1 border-2 border-[var(--ink)]/20 bg-[var(--paper)] px-3 py-2 font-mono uppercase tracking-widest outline-none focus:border-[var(--ink)]/50"
                />
                <button
                  type="button"
                  onClick={joinRoom}
                  className="bg-[var(--coral)] px-4 py-2 font-[family-name:var(--font-display)] font-bold uppercase text-white"
                >
                  Join
                </button>
              </div>
            </div>
          )}

          {room && (
            <div className="mt-8 border-2 border-[var(--ink)]/15 bg-[var(--paper)]/90 p-4">
              <p className="text-xs uppercase tracking-widest text-[var(--mute)]">
                Room code
              </p>
              <p className="font-[family-name:var(--font-display)] text-5xl font-extrabold tracking-[0.2em]">
                {room.code}
              </p>
              <p className="mt-3 text-sm text-[var(--ink)]/70">
                You are <strong>Char {seat}</strong>. Friend visits{" "}
                <code className="rounded bg-[var(--ink)]/10 px-1">{lanHint}</code>{" "}
                → Online → Join with this code.
              </p>
              <div className="mt-4 flex gap-4 text-xs uppercase tracking-wider">
                <span className={room.seats[1] ? "text-[var(--teal)]" : "text-[var(--mute)]"}>
                  Char 1 {room.seats[1] ? "ready" : "…"}
                </span>
                <span className={room.seats[2] ? "text-[var(--coral)]" : "text-[var(--mute)]"}>
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

  if (!room || !seat) return null;

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
