import { NextRequest, NextResponse } from "next/server";
import type { ClashResolveResponse } from "@/lib/clash";
import {
  applyResolve,
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  liveActive,
  MAX_CHARS,
  publicState,
  rematch,
  saveRoomState,
  seatForToken,
  startMatch,
} from "@/lib/room-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function originOf(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "http";
  if (host) return `${proto}://${host}`;
  return `http://127.0.0.1:${process.env.PORT || 3000}`;
}

export async function GET(req: NextRequest) {
  const code = String(req.nextUrl.searchParams.get("code") || "")
    .trim()
    .toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }
  const room = await getRoom(code);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  return NextResponse.json({ state: publicState(room) });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action || "");
  const token = String(body.token || "").trim();
  if (!token || token.length < 8) {
    return NextResponse.json({ error: "Missing player token" }, { status: 400 });
  }

  if (action === "create") {
    const result = await createRoom(token);
    return NextResponse.json({ ok: true, ...result });
  }

  const code = String(body.code || "")
    .trim()
    .toUpperCase();

  if (action === "join") {
    const result = await joinRoom(code, token);
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  }

  if (action === "start") {
    const result = await startMatch(code, token);
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  }

  if (action === "rematch") {
    const result = await rematch(code, token);
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  }

  if (action === "leave") {
    await leaveRoom(code, token);
    return NextResponse.json({ ok: true });
  }

  if (action === "prompt") {
    const room = await getRoom(code);
    if (!room) {
      return NextResponse.json({ ok: false, error: "Room not found" }, { status: 404 });
    }
    const seat = seatForToken(room, token);
    if (!seat) {
      return NextResponse.json({ ok: false, error: "Not in room" }, { status: 403 });
    }
    if (room.phase !== "live") {
      return NextResponse.json({ ok: false, error: "Match not live" }, { status: 400 });
    }
    if ((seat === 1 && room.busy1) || (seat === 2 && room.busy2)) {
      return NextResponse.json({ ok: false, error: "Already resolving" }, { status: 400 });
    }

    const text = String(body.prompt || "").trim();
    if (!text) {
      return NextResponse.json({ ok: false, error: "Empty prompt" }, { status: 400 });
    }

    const budget = seat === 1 ? room.budget1 : room.budget2;
    if (text.length > budget) {
      return NextResponse.json({ ok: false, error: "Not enough chars" }, { status: 400 });
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
    await saveRoomState(room);

    try {
      const forged = seat === 1 ? room.agent1.forged : room.agent2.forged;
      const res = await fetch(`${originOf(req)}/api/clash`, {
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
      const data = (await res.json()) as ClashResolveResponse & { error?: string };
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
      await saveRoomState(room);
    }

    return NextResponse.json({ ok: true, state: publicState(room) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
