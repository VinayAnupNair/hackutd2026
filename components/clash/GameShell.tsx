"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_CHARS,
  MAX_DAMAGE,
  MAX_HP,
  MIN_DAMAGE,
  REGEN_CHARS,
  REGEN_MS,
  START_CHARS,
  clamp,
  emptyAgent,
  emptyStatus,
  estimateMoveMs,
  isBlocking,
  type ActionKind,
  type ActiveMove,
  type Agent,
  type AnimSpec,
  type ClashResolveResponse,
  type FighterStatus,
  type PlayerId,
  type StoryBeat,
} from "@/lib/clash";
import { Arena } from "./Arena";
import { HPBar } from "./HPBar";
import { OnlineShell } from "./OnlineShell";
import { PromptPanel } from "./PromptPanel";
import { Storyboard } from "./Storyboard";

type Phase = "lobby" | "live" | "over";
type MenuMode = "home" | "local" | "online";

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function GameShell() {
  const [menu, setMenu] = useState<MenuMode>("home");
  const [phase, setPhase] = useState<Phase>("lobby");
  const [agent1, setAgent1] = useState<Agent>(emptyAgent());
  const [agent2, setAgent2] = useState<Agent>(emptyAgent());
  const [hp1, setHp1] = useState(MAX_HP);
  const [hp2, setHp2] = useState(MAX_HP);
  const [status1, setStatus1] = useState<FighterStatus>(emptyStatus());
  const [status2, setStatus2] = useState<FighterStatus>(emptyStatus());
  const [budget1, setBudget1] = useState(START_CHARS);
  const [budget2, setBudget2] = useState(START_CHARS);
  const [regen1, setRegen1] = useState(REGEN_MS);
  const [regen2, setRegen2] = useState(REGEN_MS);
  const [beats, setBeats] = useState<StoryBeat[]>([]);
  const [priors, setPriors] = useState<string[]>([]);
  const [busy1, setBusy1] = useState(false);
  const [busy2, setBusy2] = useState(false);
  const [actor, setActor] = useState<PlayerId | null>(null);
  const [anim, setAnim] = useState<AnimSpec | null>(null);
  const [hitKey, setHitKey] = useState(0);
  const [lastDamage, setLastDamage] = useState(0);
  const [oppActor, setOppActor] = useState<PlayerId | null>(null);
  const [oppAnim, setOppAnim] = useState<AnimSpec | null>(null);
  const [oppHitKey, setOppHitKey] = useState(0);
  const [oppDamage, setOppDamage] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [winner, setWinner] = useState<1 | 2 | null>(null);
  const [promptCount, setPromptCount] = useState(0);
  const [, setTick] = useState(0);

  const matchStart = useRef(0);
  const turn = useRef(0);
  const phaseRef = useRef<Phase>("lobby");
  const agentsRef = useRef({ agent1, agent2 });
  const hpRef = useRef({ hp1, hp2 });
  const statusRef = useRef({ status1, status2 });
  const priorsRef = useRef<string[]>([]);
  const beatsRef = useRef<StoryBeat[]>([]);
  const promptCountRef = useRef(0);
  const activeRef = useRef<{ 1: ActiveMove | null; 2: ActiveMove | null }>({
    1: null,
    2: null,
  });

  const liveActive = (m: ActiveMove | null): ActiveMove | null =>
    m && m.until > Date.now() - 200 ? m : null;

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    agentsRef.current = { agent1, agent2 };
  }, [agent1, agent2]);
  useEffect(() => {
    hpRef.current = { hp1, hp2 };
  }, [hp1, hp2]);
  useEffect(() => {
    statusRef.current = { status1, status2 };
  }, [status1, status2]);
  useEffect(() => {
    priorsRef.current = priors;
  }, [priors]);
  useEffect(() => {
    beatsRef.current = beats;
  }, [beats]);
  useEffect(() => {
    promptCountRef.current = promptCount;
  }, [promptCount]);

  // Refresh block timers in UI
  useEffect(() => {
    if (phase !== "live") return;
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [phase]);

  const resetMatch = useCallback(() => {
    setAgent1(emptyAgent());
    setAgent2(emptyAgent());
    setHp1(MAX_HP);
    setHp2(MAX_HP);
    setStatus1(emptyStatus());
    setStatus2(emptyStatus());
    setBudget1(START_CHARS);
    setBudget2(START_CHARS);
    setRegen1(REGEN_MS);
    setRegen2(REGEN_MS);
    const intro: StoryBeat = {
      id: uid(),
      turn: 0,
      player: "system",
      text: "Forge weird agents, then do anything — punch, block, fly, spawn a fireball gun, throw bubbles. Generics hit soft. Defend blocks for a few seconds. Unique prompts win.",
      at: Date.now(),
    };
    setBeats([intro]);
    setPriors([]);
    setBusy1(false);
    setBusy2(false);
    setActor(null);
    setAnim(null);
    setHitKey(0);
    setLastDamage(0);
    setOppActor(null);
    setOppAnim(null);
    setOppHitKey(0);
    setOppDamage(0);
    setFlash(null);
    setWinner(null);
    setPromptCount(0);
    turn.current = 0;
    matchStart.current = Date.now();
    activeRef.current = { 1: null, 2: null };
    setPhase("live");
  }, []);

  useEffect(() => {
    if (phase !== "live") return;
    const id = window.setInterval(() => {
      setRegen1((t) => {
        if (t <= 1000) {
          setBudget1((b) => Math.min(MAX_CHARS, b + REGEN_CHARS));
          return REGEN_MS;
        }
        return t - 1000;
      });
      setRegen2((t) => {
        if (t <= 1000) {
          setBudget2((b) => Math.min(MAX_CHARS, b + REGEN_CHARS));
          return REGEN_MS;
        }
        return t - 1000;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  const pushBeat = useCallback(
    (beat: Omit<StoryBeat, "id" | "turn" | "at">) => {
      turn.current += 1;
      const next: StoryBeat = {
        ...beat,
        id: uid(),
        turn: turn.current,
        at: Date.now(),
      };
      setBeats((prev) => {
        const updated = [...prev, next];
        beatsRef.current = updated;
        return updated;
      });
    },
    []
  );

  async function resolvePrompt(player: PlayerId, prompt: string) {
    if (phaseRef.current !== "live") return;
    if (player === 1 && busy1) return;
    if (player === 2 && busy2) return;

    const cost = prompt.length;
    if (player === 1) {
      if (cost > budget1) return;
      setBudget1((b) => b - cost);
      setBusy1(true);
    } else {
      if (cost > budget2) return;
      setBudget2((b) => b - cost);
      setBusy2(true);
    }

    // Provisional active so the other player can clash into this mid-resolve
    activeRef.current[player] = {
      player,
      prompt,
      until: Date.now() + 8000,
    };

    const { agent1: a1, agent2: a2 } = agentsRef.current;
    const { hp1: h1, hp2: h2 } = hpRef.current;
    const { status1: s1, status2: s2 } = statusRef.current;
    const forged = player === 1 ? a1.forged : a2.forged;
    const resolvePhase = forged ? "battle" : "forge";

    try {
      const res = await fetch("/api/clash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player,
          prompt,
          phase: resolvePhase,
          agent1: a1,
          agent2: a2,
          hp1: h1,
          hp2: h2,
          status1: s1,
          status2: s2,
          priorPrompts: priorsRef.current,
          story: beatsRef.current.map((b) => b.text),
          matchElapsedMs: Date.now() - matchStart.current,
          promptIndex: promptCountRef.current,
          active1: liveActive(activeRef.current[1]),
          active2: liveActive(activeRef.current[2]),
        }),
      });

      const data = (await res.json()) as ClashResolveResponse & {
        error?: string;
      };

      if (!res.ok || data.error) {
        activeRef.current[player] = null;
        pushBeat({
          player: "system",
          text: "The referee glitched. Try another prompt.",
        });
        if (player === 1) setBudget1((b) => Math.min(MAX_CHARS, b + cost));
        else setBudget2((b) => Math.min(MAX_CHARS, b + cost));
        return;
      }

      const action: ActionKind = data.action || "attack";
      let dealt = clamp(
        Math.round(Number(data.damage) || 0),
        MIN_DAMAGE,
        MAX_DAMAGE
      );

      if (data.agentUpdate) {
        if (player === 1) {
          setAgent1((a) => ({ ...a, ...data.agentUpdate, forged: true }));
        } else {
          setAgent2((a) => ({ ...a, ...data.agentUpdate, forged: true }));
        }
      }

      const now = Date.now();
      const target: PlayerId = player === 1 ? 2 : 1;
      const targetStatus = target === 1 ? statusRef.current.status1 : statusRef.current.status2;

      // Apply self status: block / effects
      if (action === "block" && data.blockMs) {
        const patch: Partial<FighterStatus> = {
          blockUntil: now + data.blockMs,
          blockPower: clamp(Number(data.blockPower) || 0.75, 0.4, 1),
        };
        if (player === 1) {
          setStatus1((s) => {
            const next = { ...s, ...patch };
            statusRef.current = { ...statusRef.current, status1: next };
            return next;
          });
        } else {
          setStatus2((s) => {
            const next = { ...s, ...patch };
            statusRef.current = { ...statusRef.current, status2: next };
            return next;
          });
        }
        dealt = 0;
      }

      if ((action === "move" || action === "dodge" || action === "spawn" || action === "buff") && data.effectMs) {
        const flying = /fly|air|hover|float|soar/i.test(data.effectLabel || prompt);
        const patch: Partial<FighterStatus> = {
          buffUntil: now + data.effectMs,
          buffNote: data.effectLabel || action,
          flyingUntil: flying ? now + data.effectMs : 0,
        };
        if (player === 1) {
          setStatus1((s) => {
            const next = { ...s, ...patch };
            statusRef.current = { ...statusRef.current, status1: next };
            return next;
          });
        } else {
          setStatus2((s) => {
            const next = { ...s, ...patch };
            statusRef.current = { ...statusRef.current, status2: next };
            return next;
          });
        }
      }

      // Heal self
      if (action === "heal" && data.heal) {
        const heal = clamp(Math.round(data.heal), 0, 12);
        if (player === 1) {
          const next = Math.min(MAX_HP, hpRef.current.hp1 + heal);
          hpRef.current = { ...hpRef.current, hp1: next };
          setHp1(next);
        } else {
          const next = Math.min(MAX_HP, hpRef.current.hp2 + heal);
          hpRef.current = { ...hpRef.current, hp2: next };
          setHp2(next);
        }
        dealt = 0;
      }

      // Mitigate incoming damage if target is blocking
      let blocked = false;
      if (dealt > 0 && isBlocking(targetStatus, now)) {
        const mitigated = Math.round(dealt * (1 - targetStatus.blockPower));
        blocked = mitigated < dealt;
        dealt = mitigated;
      }

      // Pure defensive / utility: no opponent HP change
      const damagesOpponent =
        dealt > 0 &&
        action !== "block" &&
        action !== "heal" &&
        !(action === "dodge" && dealt === 0);

      const nextAnim: AnimSpec =
        data.anim || {
          style: action === "block" ? "block" : action === "move" ? "dance" : "punch",
          hits: dealt > 0,
          intensity: 0.5,
        };
      if (!damagesOpponent) {
        nextAnim.hits = false;
        nextAnim.reaction = "none";
        nextAnim.force = 0;
      }

      // Track what this fighter is now doing (for concurrent clashes)
      const moveMs = estimateMoveMs({
        anim: nextAnim,
        effectMs: data.effectMs,
        blockMs: data.blockMs,
        action,
      });
      activeRef.current[player] = {
        player,
        prompt,
        action,
        style: nextAnim.style,
        until: Date.now() + moveMs,
      };

      // Hit interrupted the opponent's current move
      if (data.interruptOpponent || (damagesOpponent && dealt > 0)) {
        activeRef.current[target] = null;
      }

      setActor(player);
      setAnim(nextAnim);
      setLastDamage(dealt);
      setHitKey((k) => k + 1);

      // Concurrent opponent reaction (dodge slip, brace…) — both play at once
      if (data.opponentAnim) {
        setOppActor(target);
        setOppAnim(data.opponentAnim);
        setOppDamage(0);
        setOppHitKey((k) => k + 1);
      }

      setFlash(
        data.highlight ||
          (data.clash === "dodge"
            ? "DODGE"
            : action === "block"
              ? "BLOCK"
              : blocked
                ? "BLOCKED"
                : dealt === 0
                  ? "WHIFF"
                  : "HIT")
      );
      window.setTimeout(() => {
        setFlash(null);
      }, action === "block" ? 1400 : 1100);

      let nextTargetHp =
        target === 1 ? hpRef.current.hp1 : hpRef.current.hp2;
      if (damagesOpponent) {
        nextTargetHp = Math.max(0, nextTargetHp - dealt);
        if (target === 1) {
          hpRef.current = { ...hpRef.current, hp1: nextTargetHp };
          setHp1(nextTargetHp);
        } else {
          hpRef.current = { ...hpRef.current, hp2: nextTargetHp };
          setHp2(nextTargetHp);
        }
      }

      pushBeat({
        player,
        text:
          blocked && dealt === 0
            ? `${data.storyBeat} The guard ate the hit.`
            : blocked
              ? `${data.storyBeat} Partial block — only ${dealt} landed.`
              : data.storyBeat,
        action,
        damage: damagesOpponent ? dealt : undefined,
        blocked,
        uniqueness: data.uniqueness,
        speedBonus: data.speedBonus,
        effectMs: data.blockMs || data.effectMs,
      });

      setPriors((p) => {
        const updated = [...p, prompt].slice(-24);
        priorsRef.current = updated;
        return updated;
      });
      setPromptCount((c) => {
        const next = c + 1;
        promptCountRef.current = next;
        return next;
      });

      if (damagesOpponent && nextTargetHp <= 0 && phaseRef.current === "live") {
        const win: PlayerId = target === 1 ? 2 : 1;
        setWinner(win);
        setPhase("over");
        pushBeat({
          player: "system",
          text: `Char ${win} takes the ring. The storyboard closes on a decisive prompt.`,
        });
      }
    } catch {
      activeRef.current[player] = null;
      pushBeat({
        player: "system",
        text: "Connection to the referee dropped. Characters refunded.",
      });
      if (player === 1) setBudget1((b) => Math.min(MAX_CHARS, b + cost));
      else setBudget2((b) => Math.min(MAX_CHARS, b + cost));
    } finally {
      if (player === 1) setBusy1(false);
      else setBusy2(false);
    }
  }

  const blockLeft = (s: FighterStatus) =>
    isBlocking(s) ? Math.max(0, (s.blockUntil - Date.now()) / 1000) : 0;

  if (menu === "online") {
    return <OnlineShell onBack={() => setMenu("home")} />;
  }

  if (phase === "lobby" || menu === "home") {
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
            Play hotseat on one screen, or host a live room so a friend on your
            Wi‑Fi joins as Char 2 in real time.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                setMenu("local");
                resetMatch();
              }}
              className="w-fit bg-[var(--ink)] px-8 py-3.5 font-[family-name:var(--font-display)] text-lg font-bold uppercase tracking-wide text-[var(--paper)] transition hover:bg-[var(--ink)]/90"
            >
              Local hotseat
            </button>
            <button
              type="button"
              onClick={() => setMenu("online")}
              className="w-fit border-2 border-[var(--ink)] bg-transparent px-8 py-3.5 font-[family-name:var(--font-display)] text-lg font-bold uppercase tracking-wide text-[var(--ink)] transition hover:bg-[var(--ink)] hover:text-[var(--paper)]"
            >
              Online (LAN)
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-[var(--dust)]">
      <header className="flex shrink-0 items-center justify-between border-b-2 border-[var(--ink)]/15 bg-[var(--paper)] px-4 py-2.5">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-extrabold tracking-tighter uppercase md:text-2xl">
          Clash Agents
        </h1>
        <div className="flex items-center gap-3">
          {phase === "over" && (
            <button
              type="button"
              onClick={resetMatch}
              className="bg-[var(--ink)] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-[var(--paper)]"
            >
              Rematch
            </button>
          )}
          <span className="hidden text-[10px] uppercase tracking-widest text-[var(--mute)] sm:inline">
            max hit 10 · block / fly / spawn OK
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] lg:grid-cols-[minmax(240px,1fr)_minmax(320px,1.4fr)_minmax(240px,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]">
        <div className="col-span-full flex gap-4 border-b border-[var(--ink)]/10 bg-[var(--paper)]/90 px-4 py-3 lg:col-span-3">
          <div className="flex-1">
            <HPBar
              hp={hp1}
              side="teal"
              label={agent1.forged ? agent1.name : "Char 1"}
            />
            {blockLeft(status1) > 0 && (
              <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--teal)]">
                Blocking {blockLeft(status1).toFixed(1)}s ·{" "}
                {Math.round(status1.blockPower * 100)}%
              </p>
            )}
          </div>
          <div className="flex-1">
            <HPBar
              hp={hp2}
              side="coral"
              label={agent2.forged ? agent2.name : "Char 2"}
            />
            {blockLeft(status2) > 0 && (
              <p className="mt-1 text-right text-[10px] uppercase tracking-wider text-[var(--coral)]">
                Blocking {blockLeft(status2).toFixed(1)}s ·{" "}
                {Math.round(status2.blockPower * 100)}%
              </p>
            )}
          </div>
        </div>

        <div className="min-h-0 border-b border-[var(--ink)]/10 p-2 lg:order-1 lg:border-b-0 lg:border-r">
          <PromptPanel
            player={1}
            budget={budget1}
            nextRegenIn={regen1}
            disabled={phase === "over"}
            busy={busy1}
            forged={agent1.forged}
            onSubmit={(p) => resolvePrompt(1, p)}
          />
        </div>

        <div className="flex min-h-0 flex-col lg:order-2">
          <div className="min-h-[240px] flex-1 border-b border-[var(--ink)]/10 lg:min-h-0 lg:flex-[1.15]">
            <Arena
              agent1={agent1}
              agent2={agent2}
              hp1={hp1}
              hp2={hp2}
              actor={actor}
              anim={anim}
              hitKey={hitKey}
              lastDamage={lastDamage}
              oppActor={oppActor}
              oppAnim={oppAnim}
              oppHitKey={oppHitKey}
              oppDamage={oppDamage}
              blocking1={isBlocking(status1)}
              blocking2={isBlocking(status2)}
              flash={flash}
              winner={winner}
            />
          </div>
          <div className="h-44 shrink-0 lg:h-auto lg:min-h-[180px] lg:flex-1">
            <Storyboard beats={beats} />
          </div>
        </div>

        <div className="min-h-0 border-t border-[var(--ink)]/10 p-2 lg:order-3 lg:border-t-0 lg:border-l">
          <PromptPanel
            player={2}
            budget={budget2}
            nextRegenIn={regen2}
            disabled={phase === "over"}
            busy={busy2}
            forged={agent2.forged}
            onSubmit={(p) => resolvePrompt(2, p)}
          />
        </div>
      </div>
    </div>
  );
}
