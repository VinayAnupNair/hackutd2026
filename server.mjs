import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { parse } from "node:url";
import next from "next";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const MAX_HP = 100;
const START_CHARS = 100;
const REGEN_CHARS = 25;
const REGEN_MS = 10_000;
const MAX_CHARS = 200;
const MIN_DAMAGE = 0;
const MAX_DAMAGE = 10;

function emptyAgent() {
  return {
    name: "Unforged",
    epithet: "waiting in the wings",
    aura: "hollow shimmer",
    forged: false,
  };
}

function emptyStatus() {
  return {
    blockUntil: 0,
    blockPower: 0,
    flyingUntil: 0,
    buffUntil: 0,
    buffNote: "",
  };
}

function createEmptyRoom(code) {
  return {
    code,
    phase: "waiting",
    seats: { 1: false, 2: false },
    sockets: { 1: null, 2: null },
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

function estimateMoveMs({ anim, effectMs, blockMs, action } = {}) {
  const style = anim?.style;
  const laps = anim?.laps || 1;
  let base = 1400;
  if (style === "dance") base = 3200;
  else if (style === "run") base = 1400 + laps * 1100;
  else if (style === "fly") base = 2000 + laps * 1000;
  else if (style === "block" || action === "block") base = blockMs || 2800;
  else if (style === "dodge") base = 1600;
  return Math.max(base, effectMs || 0, blockMs || 0, 900);
}

function liveActive(m) {
  return m && m.until > Date.now() - 200 ? m : null;
}

function publicState(room) {
  const { sockets, ...rest } = room;
  return {
    ...rest,
    seats: {
      1: Boolean(sockets[1]),
      2: Boolean(sockets[2]),
    },
  };
}

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function isBlocking(status, now = Date.now()) {
  return now < status.blockUntil && status.blockPower > 0;
}

function lanUrls() {
  const urls = [];
  try {
    const nets = networkInterfaces();
    for (const list of Object.values(nets || {})) {
      for (const net of list || []) {
        if (net.family === "IPv4" && !net.internal) {
          urls.push(`http://${net.address}:${port}`);
        }
      }
    }
  } catch {
    // sandboxed / restricted envs
  }
  return urls;
}

const rooms = new Map();

const app = next({ dev, hostname: "localhost", port });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => {
  handle(req, res, parse(req.url, true));
});

const io = new Server(httpServer, {
  cors: { origin: "*" },
});

function emitRoom(room) {
  io.to(room.code).emit("room:state", publicState(room));
}

function tickRooms() {
  const nowRooms = [...rooms.values()].filter((r) => r.phase === "live");
  for (const room of nowRooms) {
    let changed = false;
    for (const key of ["regen1", "regen2"]) {
      const budgetKey = key === "regen1" ? "budget1" : "budget2";
      room[key] -= 1000;
      if (room[key] <= 0) {
        room[budgetKey] = Math.min(MAX_CHARS, room[budgetKey] + REGEN_CHARS);
        room[key] = REGEN_MS;
        changed = true;
      } else {
        changed = true;
      }
    }
    if (changed) emitRoom(room);
  }
}

setInterval(tickRooms, 1000);

io.on("connection", (socket) => {
  socket.data.roomCode = null;
  socket.data.seat = null;

  socket.on("room:create", (ack) => {
    leaveCurrent(socket);
    let code = makeCode();
    while (rooms.has(code)) code = makeCode();
    const room = createEmptyRoom(code);
    room.sockets[1] = socket.id;
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.seat = 1;
    const payload = { ok: true, seat: 1, state: publicState(room) };
    if (typeof ack === "function") ack(payload);
    emitRoom(room);
  });

  socket.on("room:join", ({ code } = {}, ack) => {
    const normalized = String(code || "")
      .trim()
      .toUpperCase();
    const room = rooms.get(normalized);
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Room not found" });
      return;
    }
    if (room.sockets[2]) {
      if (typeof ack === "function") ack({ ok: false, error: "Room is full" });
      return;
    }
    leaveCurrent(socket);
    room.sockets[2] = socket.id;
    socket.join(normalized);
    socket.data.roomCode = normalized;
    socket.data.seat = 2;
    if (typeof ack === "function") {
      ack({ ok: true, seat: 2, state: publicState(room) });
    }
    emitRoom(room);
  });

  socket.on("room:start", (ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.seat !== 1) {
      if (typeof ack === "function") ack({ ok: false, error: "Only host can start" });
      return;
    }
    if (!room.sockets[1] || !room.sockets[2]) {
      if (typeof ack === "function") ack({ ok: false, error: "Need both players" });
      return;
    }
    const fresh = createEmptyRoom(room.code);
    fresh.sockets = room.sockets;
    fresh.phase = "live";
    fresh.matchStartedAt = Date.now();
    fresh.beats = [
      {
        id: `intro-${Date.now()}`,
        turn: 0,
        player: "system",
        text: "Online clash live. Each of you owns one prompt panel. Unique creative moves hit harder.",
        at: Date.now(),
      },
    ];
    rooms.set(room.code, fresh);
    if (typeof ack === "function") ack({ ok: true, state: publicState(fresh) });
    emitRoom(fresh);
  });

  socket.on("room:rematch", (ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.seat !== 1) {
      if (typeof ack === "function") ack({ ok: false, error: "Only host can rematch" });
      return;
    }
    const fresh = createEmptyRoom(room.code);
    fresh.sockets = room.sockets;
    fresh.phase = "live";
    fresh.matchStartedAt = Date.now();
    fresh.beats = [
      {
        id: `intro-${Date.now()}`,
        turn: 0,
        player: "system",
        text: "Rematch! Same seats. Forge again.",
        at: Date.now(),
      },
    ];
    rooms.set(room.code, fresh);
    if (typeof ack === "function") ack({ ok: true });
    emitRoom(fresh);
  });

  socket.on("prompt:submit", async ({ prompt } = {}, ack) => {
    const room = rooms.get(socket.data.roomCode);
    const seat = socket.data.seat;
    if (!room || !seat) {
      if (typeof ack === "function") ack({ ok: false, error: "Not in a room" });
      return;
    }
    if (room.phase !== "live") {
      if (typeof ack === "function") ack({ ok: false, error: "Match not live" });
      return;
    }
    if ((seat === 1 && room.busy1) || (seat === 2 && room.busy2)) {
      if (typeof ack === "function") ack({ ok: false, error: "Already resolving" });
      return;
    }

    const text = String(prompt || "").trim();
    if (!text) {
      if (typeof ack === "function") ack({ ok: false, error: "Empty prompt" });
      return;
    }

    const budget = seat === 1 ? room.budget1 : room.budget2;
    if (text.length > budget) {
      if (typeof ack === "function") ack({ ok: false, error: "Not enough chars" });
      return;
    }

    if (seat === 1) {
      room.budget1 -= text.length;
      room.busy1 = true;
      room.active1 = { player: 1, prompt: text, until: Date.now() + 8000 };
    } else {
      room.budget2 -= text.length;
      room.busy2 = true;
      room.active2 = { player: 2, prompt: text, until: Date.now() + 8000 };
    }
    emitRoom(room);

    try {
      const forged = seat === 1 ? room.agent1.forged : room.agent2.forged;
      const res = await fetch(`http://127.0.0.1:${port}/api/clash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player: seat,
          prompt: text,
          phase: forged ? "battle" : "forge",
          agent1: room.agent1,
          agent2: room.agent2,
          hp1: room.hp1,
          hp2: room.hp2,
          status1: room.status1,
          status2: room.status2,
          priorPrompts: room.priors,
          story: room.beats.map((b) => b.text),
          matchElapsedMs: Date.now() - room.matchStartedAt,
          promptIndex: room.promptCount,
          active1: liveActive(room.active1),
          active2: liveActive(room.active2),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        if (seat === 1) {
          room.budget1 = Math.min(MAX_CHARS, room.budget1 + text.length);
          room.active1 = null;
        } else {
          room.budget2 = Math.min(MAX_CHARS, room.budget2 + text.length);
          room.active2 = null;
        }
        room.turn += 1;
        room.beats.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          turn: room.turn,
          player: "system",
          text: "Referee glitched. Characters refunded.",
          at: Date.now(),
        });
      } else {
        applyResolve(room, seat, text, data);
      }
    } catch (err) {
      console.error("prompt resolve failed", err);
      if (seat === 1) {
        room.budget1 = Math.min(MAX_CHARS, room.budget1 + text.length);
        room.active1 = null;
      } else {
        room.budget2 = Math.min(MAX_CHARS, room.budget2 + text.length);
        room.active2 = null;
      }
      room.turn += 1;
      room.beats.push({
        id: `${Date.now()}-err`,
        turn: room.turn,
        player: "system",
        text: "Connection to referee dropped. Characters refunded.",
        at: Date.now(),
      });
    } finally {
      if (seat === 1) room.busy1 = false;
      else room.busy2 = false;
      emitRoom(room);
      if (typeof ack === "function") ack({ ok: true });
    }
  });

  socket.on("disconnect", () => {
    leaveCurrent(socket);
  });
});

function leaveCurrent(socket) {
  const code = socket.data.roomCode;
  const seat = socket.data.seat;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  socket.data.seat = null;
  if (!room) return;
  if (seat && room.sockets[seat] === socket.id) {
    room.sockets[seat] = null;
  }
  if (!room.sockets[1] && !room.sockets[2]) {
    rooms.delete(code);
  } else {
    emitRoom(room);
  }
}

function applyResolve(room, seat, prompt, data) {
  const action = data.action || "attack";
  let dealt = clamp(Math.round(Number(data.damage) || 0), MIN_DAMAGE, MAX_DAMAGE);
  const now = Date.now();
  const target = seat === 1 ? 2 : 1;

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
  const activeMove = {
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
  setTimeout(() => {
    const live = rooms.get(room.code);
    if (!live || live.fx.hitKey !== fxHitKey) return;
    live.fx = { ...live.fx, flash: null };
    emitRoom(live);
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

httpServer.listen(port, hostname, () => {
  console.log(`> Clash Agents ready on http://127.0.0.1:${port}`);
  for (const url of lanUrls()) {
    console.log(`> LAN (friend): ${url}`);
  }
});
