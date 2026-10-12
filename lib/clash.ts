export const MAX_HP = 100;
export const START_CHARS = 100;
export const REGEN_CHARS = 25;
export const REGEN_MS = 10_000;
export const MAX_CHARS = 200;
export const MIN_DAMAGE = 0;
export const MAX_DAMAGE = 10;

export type PlayerId = 1 | 2;

export type ActionKind =
  | "forge"
  | "attack"
  | "block"
  | "dodge"
  | "move"
  | "spawn"
  | "buff"
  | "heal"
  | "special";

export type Agent = {
  name: string;
  epithet: string;
  aura: string;
  forged: boolean;
};

export type FighterStatus = {
  /** Timestamp ms — fully/partially blocks hits until then */
  blockUntil: number;
  /** 0–1 damage mitigation while blocking */
  blockPower: number;
  flyingUntil: number;
  buffUntil: number;
  buffNote: string;
};

export type StoryBeat = {
  id: string;
  turn: number;
  player: PlayerId | "system";
  text: string;
  action?: ActionKind;
  damage?: number;
  blocked?: boolean;
  uniqueness?: number;
  speedBonus?: number;
  effectMs?: number;
  at: number;
};

/** What a fighter is mid-doing in the ring right now (concurrent) */
export type ActiveMove = {
  player: PlayerId;
  prompt: string;
  action?: ActionKind;
  style?: AnimStyle;
  until: number;
};

/** How a prompt resolves against whatever the opponent is already doing */
export type ClashOutcome =
  | "none"
  | "hit"
  | "dodge"
  | "block"
  | "whiff"
  | "interrupt"
  | "clash";

export type ClashResolveRequest = {
  player: PlayerId;
  prompt: string;
  phase: "forge" | "battle";
  agent1: Agent;
  agent2: Agent;
  hp1: number;
  hp2: number;
  status1: FighterStatus;
  status2: FighterStatus;
  priorPrompts: string[];
  story: string[];
  matchElapsedMs: number;
  promptIndex: number;
  /** What each fighter is currently performing (if anything) */
  active1?: ActiveMove | null;
  active2?: ActiveMove | null;
};

/** AI / local choreography for the Three.js arena */
export type AnimStyle =
  | "punch"
  | "kick"
  | "slash"
  | "whip"
  | "throw"
  | "shoot"
  | "cast"
  | "block"
  | "dodge"
  | "dance"
  | "jump"
  | "run"
  | "fly"
  | "heal"
  | "buff"
  | "spawn"
  | "taunt"
  | "slam"
  | "shove"
  | "spray"
  | "flourish";

/** How the target's body reacts to the hit */
export type HitReaction =
  | "none"
  | "flinch"
  | "stagger"
  | "knockback"
  | "launch"
  | "knockdown"
  | "spin";

export type AnimProjectile = {
  shape: "box" | "sphere" | "torus" | "cone" | "cylinder" | "belt" | "blob";
  /** hex like #c45c26 */
  color: string;
  scale: number;
  spin?: boolean;
  trail?: boolean;
  /** Leaves a splat on impact (mud, slime, poop, paint…) */
  splat?: boolean;
  name?: string;
};

/** Handheld prop swung in melee (belt, bat, whip…) */
export type AnimProp = {
  kind: "belt" | "whip" | "bat" | "sword" | "staff" | "chain" | "rope" | "generic";
  color: string;
  length: number;
};

/** Minion / creature / vehicle spawned mid-move — scale is world size vs a ~2-unit fighter */
export type AnimSummon = {
  kind:
    | "dog"
    | "wolf"
    | "cat"
    | "bird"
    | "blob"
    | "golem"
    | "drone"
    | "plane"
    | "car"
    | "truck"
    | "tank"
    | "sun"
    | "generic";
  /** World size. Dog ~0.7, car ~4, plane ~12–20, sun ~50–80 (sky-filling) */
  scale: number;
  color: string;
  name?: string;
  attack?: "bite" | "slash" | "ram" | "shoot" | "tackle" | "crash";
};

/**
 * One beat inside a multi-action combo — all beats share ONE continuous motion.
 * e.g. kick@0.35 then spray@0.55, or spawn dog@0.2 then bite@0.6
 */
export type AnimBeat = {
  /** 0–1 peak time within the whole move */
  at: number;
  style: AnimStyle;
  projectile?: AnimProjectile | null;
  prop?: AnimProp | null;
  summon?: AnimSummon | null;
  hits?: boolean;
};

export type AnimSpec = {
  style: AnimStyle;
  limb?: "rightArm" | "leftArm" | "rightLeg" | "leftLeg" | "both" | "head";
  projectile?: AnimProjectile | null;
  prop?: AnimProp | null;
  /** Full orbits around the ring for run/fly (e.g. 1.5) */
  laps?: number;
  /** Orbit radius — ring is ~3.0; use 2.4–2.8 for "around the ring" */
  radius?: number;
  intensity?: number;
  hits?: boolean;
  reaction?: HitReaction;
  /** 0–1 strength of the target's reaction */
  force?: number;
  /**
   * Merged aerial attack — ONLY when the prompt actually involves flying/running/jumping.
   * e.g. style "fly" + airAction "kick" = flying kick.
   */
  airAction?: AnimStyle | null;
  /** Arbitrary multi-action combo in one continuous motion */
  beats?: AnimBeat[];
  /** Convenience single summon (also placeable on a beat) */
  summon?: AnimSummon | null;
};

export type ClashResolveResponse = {
  agentUpdate?: Partial<Agent>;
  /** What this prompt actually does — AI decides */
  action: ActionKind;
  /** 0–10. Must be 0 for pure block/dodge/move/buff unless AI adds a twist */
  damage: number;
  uniqueness: number;
  speedBonus: number;
  /** Block/shield duration in ms (for block or spawn-shield style moves) */
  blockMs?: number;
  /** 0–1 mitigation while blocking */
  blockPower?: number;
  /** Brief status like flying, bubble aura, fireball gun, etc. */
  effectMs?: number;
  effectLabel?: string;
  heal?: number;
  /** Choreography for Three.js — AI should match the prompt (kick→kick, throw brick→throw+box) */
  anim?: AnimSpec;
  /** Concurrent: optional anim on the OPPONENT (dodge slip, counter flourish…) */
  opponentAnim?: AnimSpec | null;
  /** How this prompt interacted with the opponent's current move */
  clash?: ClashOutcome;
  /** Stop the opponent's current move (hit interrupted their dance/run/…) */
  interruptOpponent?: boolean;
  storyBeat: string;
  highlight?: string;
};

/** Rough how long a move occupies the ring — used for concurrent clash windows */
export function estimateMoveMs(opts: {
  anim?: AnimSpec | null;
  effectMs?: number;
  blockMs?: number;
  action?: ActionKind;
}): number {
  const style = opts.anim?.style;
  const laps = opts.anim?.laps || 1;
  const summon =
    opts.anim?.summon || opts.anim?.beats?.find((b) => b.summon)?.summon || null;
  let base = 1400;
  if (style === "dance") base = 3200;
  else if (style === "run") base = 1400 + laps * 1100;
  else if (style === "fly") base = 2000 + laps * 1000;
  else if (style === "block" || opts.action === "block") base = opts.blockMs || 2800;
  else if (style === "dodge") base = 1600;
  else if (style === "heal" || style === "buff" || style === "taunt") base = 1800;
  else if (style === "whip" || style === "slam") base = 1600;
  if (summon?.kind === "sun") base = Math.max(base, 4500);
  else if (summon?.kind === "plane") base = Math.max(base, 3800);
  else if (summon && (summon.kind === "car" || summon.kind === "truck" || summon.kind === "tank"))
    base = Math.max(base, 3000);
  else if (summon) base = Math.max(base, 2200);
  return Math.max(base, opts.effectMs || 0, opts.blockMs || 0, 900);
}

export function emptyAgent(): Agent {
  return {
    name: "Unforged",
    epithet: "waiting in the wings",
    aura: "hollow shimmer",
    forged: false,
  };
}

export function emptyStatus(): FighterStatus {
  return {
    blockUntil: 0,
    blockPower: 0,
    flyingUntil: 0,
    buffUntil: 0,
    buffNote: "",
  };
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function isBlocking(status: FighterStatus, now = Date.now()) {
  return now < status.blockUntil && status.blockPower > 0;
}
