import { Redis } from "@upstash/redis";
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
  type ActiveMove,
  type ClashResolveResponse,
  type PlayerId,
} from "./clash";
import type { RoomSnapshot } from "./clash-room";

export type ServerRoom = RoomSnapshot & {
  tokens: { 1: string | null; 2: string | null };
  lastTick: number;
};

type GlobalRooms = {
  rooms: Map<string, ServerRoom>;
};

const ROOM_TTL_SEC = 60 * 60 * 2; // 2h

function g(): GlobalRooms {
  const key = "__clashRooms";
  const store = globalThis as typeof globalThis & { [key]?: GlobalRooms };
  if (!store[key]) {
    store[key] = { rooms: new Map() };
  }
  return store[key]!;
}

function redisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function roomKey(code: string) {
  return `clash:room:${code}`;
}

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function createServerRoom(code: string): ServerRoom {
  return {
    code,
    phase: "waiting",
    seats: { 1: false, 2: false },
    tokens: { 1: null, 2: null },
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
    lastTick: Date.now(),
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

export function publicState(room: ServerRoom): RoomSnapshot {
  const { tokens: _t, lastTick: _l, ...rest } = room;
  return {
    ...rest,
    seats: {
      1: Boolean(room.tokens[1]),
      2: Boolean(room.tokens[2]),
    },
  };
}

export function liveActive(m: ActiveMove | null): ActiveMove | null {
  return m && m.until > Date.now() - 200 ? m : null;
}

function tickRoom(room: ServerRoom) {
  if (room.phase !== "live") {
    room.lastTick = Date.now();
    return;
  }
  const now = Date.now();
  let elapsed = now - room.lastTick;
  room.lastTick = now;
  while (elapsed >= 1000) {
    elapsed -= 1000;
    for (const key of ["regen1", "regen2"] as const) {
      const budgetKey = key === "regen1" ? "budget1" : "budget2";
      room[key] -= 1000;
      if (room[key] <= 0) {
        room[budgetKey] = Math.min(MAX_CHARS, room[budgetKey] + REGEN_CHARS);
        room[key] = REGEN_MS;
      }
    }
  }
}

async function loadRoom(code: string): Promise<ServerRoom | null> {
  const redis = redisClient();
  if (redis) {
    const room = await redis.get<ServerRoom>(roomKey(code));
    if (!room) return null;
    tickRoom(room);
    await saveRoom(room);
    return room;
  }
  const room = g().rooms.get(code);
  if (!room) return null;
  tickRoom(room);
  return room;
}

async function saveRoom(room: ServerRoom) {
  const redis = redisClient();
  if (redis) {
    await redis.set(roomKey(room.code), room, { ex: ROOM_TTL_SEC });
    return;
  }
  g().rooms.set(room.code, room);
}

async function deleteRoom(code: string) {
  const redis = redisClient();
  if (redis) {
    await redis.del(roomKey(code));
    return;
  }
  g().rooms.delete(code);
}

export async function getRoom(code: string): Promise<ServerRoom | null> {
  return loadRoom(code);
}

export async function createRoom(
  token: string
): Promise<{ seat: PlayerId; state: RoomSnapshot }> {
  let code = makeCode();
  while (await loadRoom(code)) code = makeCode();
  const room = createServerRoom(code);
  room.tokens[1] = token;
  await saveRoom(room);
  return { seat: 1, state: publicState(room) };
}

export async function joinRoom(
  code: string,
  token: string
): Promise<
  { ok: true; seat: PlayerId; state: RoomSnapshot } | { ok: false; error: string }
> {
  const room = await loadRoom(code);
  if (!room) return { ok: false, error: "Room not found" };

  if (room.tokens[1] === token) {
    return { ok: true, seat: 1, state: publicState(room) };
  }
  if (room.tokens[2] === token) {
    return { ok: true, seat: 2, state: publicState(room) };
  }
  if (room.tokens[2]) return { ok: false, error: "Room is full" };

  room.tokens[2] = token;
  await saveRoom(room);
  return { ok: true, seat: 2, state: publicState(room) };
}

export function seatForToken(room: ServerRoom, token: string): PlayerId | null {
  if (room.tokens[1] === token) return 1;
  if (room.tokens[2] === token) return 2;
  return null;
}

export async function startMatch(
  code: string,
  token: string
): Promise<
  { ok: true; state: RoomSnapshot } | { ok: false; error: string }
> {
  const room = await loadRoom(code);
  if (!room) return { ok: false, error: "Room not found" };
  if (seatForToken(room, token) !== 1) {
    return { ok: false, error: "Only host can start" };
  }
  if (!room.tokens[1] || !room.tokens[2]) {
    return { ok: false, error: "Need both players" };
  }

  const fresh = createServerRoom(room.code);
  fresh.tokens = { ...room.tokens };
  fresh.phase = "live";
  fresh.matchStartedAt = Date.now();
  fresh.lastTick = Date.now();
  fresh.beats = [
    {
      id: `intro-${Date.now()}`,
      turn: 0,
      player: "system",
      text: "Online clash live. Each of you owns one prompt panel. Unique creative moves hit harder.",
      at: Date.now(),
    },
  ];
  await saveRoom(fresh);
  return { ok: true, state: publicState(fresh) };
}

export async function rematch(
  code: string,
  token: string
): Promise<
  { ok: true; state: RoomSnapshot } | { ok: false; error: string }
> {
  const room = await loadRoom(code);
  if (!room) return { ok: false, error: "Room not found" };
  if (seatForToken(room, token) !== 1) {
    return { ok: false, error: "Only host can rematch" };
  }

  const fresh = createServerRoom(room.code);
  fresh.tokens = { ...room.tokens };
  fresh.phase = "live";
  fresh.matchStartedAt = Date.now();
  fresh.lastTick = Date.now();
  fresh.beats = [
    {
      id: `intro-${Date.now()}`,
      turn: 0,
      player: "system",
      text: "Rematch! Same seats. Forge again.",
      at: Date.now(),
    },
  ];
  await saveRoom(fresh);
  return { ok: true, state: publicState(fresh) };
}

export async function leaveRoom(code: string, token: string) {
  const room = await loadRoom(code);
  if (!room) return;
  const seat = seatForToken(room, token);
  if (!seat) return;
  room.tokens[seat] = null;
  if (!room.tokens[1] && !room.tokens[2]) {
    await deleteRoom(code);
  } else {
    await saveRoom(room);
  }
}

export async function saveRoomState(room: ServerRoom) {
  await saveRoom(room);
}

export function applyResolve(
  room: ServerRoom,
  seat: PlayerId,
  prompt: string,
  data: ClashResolveResponse
) {
  const action = data.action || "attack";
  let dealt = clamp(Math.round(Number(data.damage) || 0), MIN_DAMAGE, MAX_DAMAGE);
  const now = Date.now();
  const target: PlayerId = seat === 1 ? 2 : 1;

  if (data.agentUpdate) {
    if (seat === 1) room.agent1 = { ...room.agent1, ...data.agentUpdate, forged: true };
    else room.agent2 = { ...room.agent2, ...data.agentUpdate, forged: true };
  }

  if (action === "block" && data.blockMs) {
    const patch = {
      blockUntil: now + data.blockMs,
      blockPower: clamp(Number(data.blockPower) || 0.75, 0.4, 1),
    };
    if (seat === 1) room.status1 = { ...room.status1, ...patch };
    else room.status2 = { ...room.status2, ...patch };
    dealt = 0;
  }

  if (
    (action === "move" || action === "dodge" || action === "spawn" || action === "buff") &&
    data.effectMs
  ) {
    const flying = /fly|air|hover|float|soar/i.test(data.effectLabel || prompt);
    const patch = {
      buffUntil: now + data.effectMs,
      buffNote: data.effectLabel || action,
      flyingUntil: flying ? now + data.effectMs : 0,
    };
    if (seat === 1) room.status1 = { ...room.status1, ...patch };
    else room.status2 = { ...room.status2, ...patch };
  }

  if (action === "heal" && data.heal) {
    const heal = clamp(Math.round(data.heal), 0, 12);
    if (seat === 1) room.hp1 = Math.min(MAX_HP, room.hp1 + heal);
    else room.hp2 = Math.min(MAX_HP, room.hp2 + heal);
    dealt = 0;
  }

  const targetStatus = target === 1 ? room.status1 : room.status2;
  let blocked = false;
  if (dealt > 0 && isBlocking(targetStatus, now)) {
    const mitigated = Math.round(dealt * (1 - targetStatus.blockPower));
    blocked = mitigated < dealt;
    dealt = mitigated;
  }

  const damagesOpponent =
    dealt > 0 &&
    action !== "block" &&
    action !== "heal" &&
    !(action === "dodge" && dealt === 0);

  const nextAnim =
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

  const moveMs = estimateMoveMs({
    anim: nextAnim,
    effectMs: data.effectMs,
    blockMs: data.blockMs,
    action,
  });
  const activeMove: ActiveMove = {
    player: seat,
    prompt,
    action,
    style: nextAnim.style,
    until: now + moveMs,
  };
  if (seat === 1) room.active1 = activeMove;
  else room.active2 = activeMove;

  if (data.interruptOpponent || (damagesOpponent && dealt > 0)) {
    if (target === 1) room.active1 = null;
    else room.active2 = null;
  }

  const oppAnim = data.opponentAnim || null;
  room.fx = {
    actor: seat,
    anim: nextAnim,
    damage: dealt,
    flash:
      data.highlight ||
      (data.clash === "dodge"
        ? "DODGE"
        : action === "block"
          ? "BLOCK"
          : blocked
            ? "BLOCKED"
            : dealt === 0
              ? "WHIFF"
              : "HIT"),
    hitKey: room.fx.hitKey + 1,
    oppActor: oppAnim ? target : null,
    oppAnim,
    oppDamage: 0,
    oppHitKey: oppAnim ? room.fx.oppHitKey + 1 : room.fx.oppHitKey,
  };

  const fxHitKey = room.fx.hitKey;
  const roomCode = room.code;
  setTimeout(() => {
    void (async () => {
      const live = await loadRoom(roomCode);
      if (!live || live.fx.hitKey !== fxHitKey) return;
      live.fx = { ...live.fx, flash: null };
      await saveRoom(live);
    })();
  }, 1200);

  if (damagesOpponent) {
    if (target === 1) room.hp1 = Math.max(0, room.hp1 - dealt);
    else room.hp2 = Math.max(0, room.hp2 - dealt);
  }

  room.turn += 1;
  room.beats.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    turn: room.turn,
    player: seat,
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
    at: now,
  });
  if (room.beats.length > 80) room.beats = room.beats.slice(-80);

  room.priors = [...room.priors, prompt].slice(-24);
  room.promptCount += 1;

  if (damagesOpponent && (room.hp1 <= 0 || room.hp2 <= 0)) {
    room.winner = room.hp1 <= 0 ? 2 : 1;
    room.phase = "over";
    room.turn += 1;
    room.beats.push({
      id: `${Date.now()}-win`,
      turn: room.turn,
      player: "system",
      text: `Char ${room.winner} takes the ring.`,
      at: Date.now(),
    });
  }
}

export { MAX_CHARS };
