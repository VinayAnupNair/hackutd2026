import {
  MAX_CHARS,
  MAX_HP,
  REGEN_MS,
  START_CHARS,
  emptyAgent,
  emptyStatus,
  type ActiveMove,
  type Agent,
  type AnimSpec,
  type FighterStatus,
  type PlayerId,
  type StoryBeat,
} from "./clash";

export type RoomPhase = "waiting" | "live" | "over";

export type RoomSnapshot = {
  code: string;
  phase: RoomPhase;
  seats: { 1: boolean; 2: boolean };
  agent1: Agent;
  agent2: Agent;
  hp1: number;
  hp2: number;
  status1: FighterStatus;
  status2: FighterStatus;
  budget1: number;
  budget2: number;
  regen1: number;
  regen2: number;
  beats: StoryBeat[];
  priors: string[];
  promptCount: number;
  matchStartedAt: number;
  turn: number;
  winner: PlayerId | null;
  busy1: boolean;
  busy2: boolean;
  /** What each fighter is mid-doing (concurrent clashes) */
  active1: ActiveMove | null;
  active2: ActiveMove | null;
  /** Latest FX for both clients — primary + optional concurrent opponent play */
  fx: {
    actor: PlayerId | null;
    anim: AnimSpec | null;
    damage: number;
    flash: string | null;
    hitKey: number;
    oppActor: PlayerId | null;
    oppAnim: AnimSpec | null;
    oppDamage: number;
    oppHitKey: number;
  };
};

export function createEmptyRoom(code: string): RoomSnapshot {
  return {
    code,
    phase: "waiting",
    seats: { 1: false, 2: false },
    agent1: emptyAgent(),
    agent2: emptyAgent(),
    hp1: MAX_HP,
    hp2: MAX_HP,
    status1: emptyStatus(),
    status2: emptyStatus(),
    budget1: START_CHARS,
    budget2: START_CHARS,
    regen1: REGEN_MS,
    regen2: REGEN_MS,
    beats: [],
    priors: [],
    promptCount: 0,
    matchStartedAt: 0,
    turn: 0,
    winner: null,
    busy1: false,
    busy2: false,
    active1: null,
    active2: null,
    fx: {
      actor: null,
      anim: null,
      damage: 0,
      flash: null,
      hitKey: 0,
      oppActor: null,
      oppAnim: null,
      oppDamage: 0,
      oppHitKey: 0,
    },
  };
}

export function startMatchState(room: RoomSnapshot): RoomSnapshot {
  return {
    ...createEmptyRoom(room.code),
    seats: { ...room.seats },
    phase: "live",
    matchStartedAt: Date.now(),
    beats: [
      {
        id: `intro-${Date.now()}`,
        turn: 0,
        player: "system",
        text: "Online clash live. You each control one char. Unique prompts hit harder — defend blocks, dance doesn't damage. Fight!",
        at: Date.now(),
      },
    ],
  };
}

export { MAX_CHARS, START_CHARS, REGEN_MS };
