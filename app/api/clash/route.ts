import { NextResponse } from "next/server";
import type {
  ActionKind,
  AnimBeat,
  AnimProjectile,
  AnimProp,
  AnimSpec,
  AnimStyle,
  AnimSummon,
  ClashOutcome,
  ClashResolveRequest,
  ClashResolveResponse,
  HitReaction,
} from "@/lib/clash";
import { MAX_DAMAGE, MIN_DAMAGE, clamp } from "@/lib/clash";
import {
  fallbackResolve,
  inferAction,
  inferAirAction,
  inferAnim,
  inferComboBeats,
  inferSummon,
  isAerialCombo,
  isLiquidPrompt,
  isRepeatPrompt,
  scoreUniqueness,
} from "@/lib/clash-judge";

const SUMMON_KINDS: AnimSummon["kind"][] = [
  "dog",
  "wolf",
  "cat",
  "bird",
  "blob",
  "golem",
  "drone",
  "plane",
  "car",
  "truck",
  "tank",
  "sun",
  "generic",
];

/** Default realistic scales — fighter is ~2 units tall */
const SUMMON_SCALE: Record<AnimSummon["kind"], number> = {
  bird: 0.35,
  cat: 0.45,
  dog: 0.75,
  wolf: 0.95,
  drone: 0.55,
  blob: 0.9,
  golem: 2.2,
  car: 4.2,
  tank: 5.5,
  truck: 7,
  plane: 14,
  sun: 58,
  generic: 1.2,
};

const CLASH_OUTCOMES: ClashOutcome[] = [
  "none",
  "hit",
  "dodge",
  "block",
  "whiff",
  "interrupt",
  "clash",
];

const REACTIONS: HitReaction[] = [
  "none",
  "flinch",
  "stagger",
  "knockback",
  "launch",
  "knockdown",
  "spin",
];

const PROJECTILE_SHAPES: AnimProjectile["shape"][] = [
  "box",
  "sphere",
  "torus",
  "cone",
  "cylinder",
  "belt",
  "blob",
];

const PROP_KINDS: AnimProp["kind"][] = [
  "belt",
  "whip",
  "bat",
  "sword",
  "staff",
  "chain",
  "rope",
  "generic",
];

const HEX = /^#[0-9a-f]{6}$/i;

function agentLabel(agent: ClashResolveRequest["agent1"] | undefined, id: number) {
  return agent?.forged && agent.name ? agent.name : `Char ${id}`;
}

function validProp(p: AnimSpec["prop"] | undefined): AnimProp | null {
  if (!p || typeof p !== "object" || !PROP_KINDS.includes(p.kind)) return null;
  return {
    kind: p.kind,
    color: HEX.test(String(p.color)) ? p.color : "#4a453c",
    length: clamp(Number(p.length) || 1.2, 0.6, 2),
  };
}

function validSummon(s: AnimSpec["summon"] | undefined): AnimSummon | null {
  if (!s || typeof s !== "object") return null;
  const kind = SUMMON_KINDS.includes(s.kind) ? s.kind : "generic";
  const fallback = SUMMON_SCALE[kind] || 1.2;
  // Allow sky-filling celestial / huge vehicles — old 2.5 cap made them toys
  const maxScale =
    kind === "sun" ? 90 : kind === "plane" ? 36 : kind === "truck" || kind === "tank" ? 16 : kind === "car" ? 10 : 6;
  const minScale =
    kind === "sun"
      ? 28
      : kind === "plane"
        ? 8
        : kind === "car" || kind === "truck" || kind === "tank"
          ? 2.5
          : 0.2;
  const raw = Number(s.scale);
  // If the model undersizes (toy plane at 1–2), snap to realistic default
  const scale =
    !Number.isFinite(raw) || raw < fallback * 0.55
      ? fallback
      : clamp(raw, minScale, maxScale);
  return {
    kind,
    color: HEX.test(String(s.color))
      ? s.color
      : kind === "sun"
        ? "#ffb020"
        : kind === "plane"
          ? "#d6dde6"
          : kind === "car"
            ? "#c45c26"
            : kind === "truck"
              ? "#4a5568"
              : kind === "tank"
                ? "#5c6b4a"
                : "#8b5a2b",
    scale: clamp(scale, minScale, maxScale),
    name: s.name || (kind === "sun" ? "the sun" : kind),
    attack:
      s.attack ||
      (kind === "sun" || kind === "plane" || kind === "truck" || kind === "tank" || kind === "car"
        ? "crash"
        : "tackle"),
  };
}

function normalizeBeats(beats: AnimBeat[], damage: number): AnimBeat[] {
  return beats
    .filter((b) => b && ANIM_STYLES.includes(b.style))
    .map((b) => ({
      at: clamp(Number(b.at) || 0.5, 0.05, 0.95),
      style: b.style,
      hits: b.hits ?? damage > 0,
      projectile: b.projectile || null,
      prop: validProp(b.prop) || null,
      summon: validSummon(b.summon) || null,
    }))
    .sort((a, b) => a.at - b.at);
}

const ANIM_STYLES: AnimStyle[] = [
  "punch",
  "kick",
  "slash",
  "whip",
  "throw",
  "shoot",
  "cast",
  "block",
  "dodge",
  "dance",
  "jump",
  "run",
  "fly",
  "heal",
  "buff",
  "spawn",
  "taunt",
  "slam",
  "shove",
  "spray",
  "flourish",
];

const GROQ_MODEL = "openai/gpt-oss-120b";

const ACTIONS: ActionKind[] = [
  "forge",
  "attack",
  "block",
  "dodge",
  "move",
  "spawn",
  "buff",
  "heal",
  "special",
];

const SYSTEM = `You are the referee AND fight choreographer for Clash Agents — a two-player prompt arena.
Whatever the prompt describes HAPPENS. You decide the outcome; nothing is a fixed move list.
BOTH fighters can act AT THE SAME TIME — the ring is concurrent.

The prompt is ALWAYS written by "attacker" (the prompter's agent); "him/her/them" means "defender".

READ INTENT CAREFULLY — WHO MOVES?
- If the prompter's agent moves itself (run, fly, dance, jump, hover) → action "move", damage 0.
- If the prompt makes the OPPONENT move or suffer ("send him flying", "knock her out of the ring",
  "yeet them into orbit", "trip him", "throw poop at him") → that is an ATTACK on the opponent.
  "flying" in "send him flying" describes the VICTIM, not the attacker.
- defend / block / guard / shield → action "block", damage 0, set blockMs (1200–7000) + blockPower (0–1).
- Healing yourself → "heal", damage 0, set heal (1–12).
- Summoning / equipping → "spawn"; damage only if it's used on the opponent in the same prompt.

CONCURRENT CLASHES (critical — look at active1 / active2):
The opponent may ALREADY be mid-move (dancing, running, flying, blocking, attacking…).
You decide how the NEW prompt interacts with that live state — not a keyword table.
Examples:
- Defender is dancing/running/flying and attacker swings → often clash "dodge" (they slip aside mid-motion),
  damage 0, anim.hits false, opponentAnim style "dodge", interruptOpponent false (they keep moving after).
- Defender is blocking → clash "block", damage 0 or heavily reduced, interruptOpponent false.
- Clean hit into an open dance → clash "hit" or "interrupt", full damage, interruptOpponent true,
  reaction on anim so they get knocked out of the dance.
- Both mid-attack → clash "clash": maybe both get clipped, or one wins — you decide; set damage accordingly.
- Attacker whiffs a generic into clever motion → clash "whiff", damage 0.
Always narrate the concurrent situation in storyBeat ("while Char 2 twirls…", "mid-flight…").
Set clash to "none" if the opponent isn't doing anything relevant.

UNIQUENESS (0-100), judged against priorPrompts:
- Bare generics (punch, kick, defend, dance, run, jump, typos of them) → 5–25.
- Exact or near repeats of priorPrompts → 0–15.
- Specific, vivid, funny, surprising, multi-detail prompts → 55–95. Reward creativity generously.

DAMAGE: integer 0–10. Attacks scale with uniqueness and clash outcome:
  uniq <25 → 0–2 · 25–50 → 2–5 · 50–75 → 4–8 · 75+ → 7–10.
  Non-attacks (move/block/dodge/heal/buff) → 0 always.
  dodge / block / whiff clashes → damage 0.

ANIM — choreography for a physics-driven Three.js scene. Make it LITERAL to the prompt:
- style: what the ATTACKER's body does (kick, punch, whip, throw, shove, slam, run, fly, dance…).
- prop / projectile as needed (poop → blob brown splat true; brick → box; fireball → sphere+trail).
- GROSS / FUNNY LIQUIDS ARE THE JOKE — NEVER skip the projectile:
  cum / jizz / piss / pee → action "attack", style "spray" (NOT throw!).
  Spray = lewd hip-thrust from the crotch/bottom with hands framing the hips —
  liquid bursts FROM THE PELVIS, not from the hands. Never narrate it as "hurls" or "throws".
  spit / vomit → style "cast" from the mouth. poop / pie / paint / slime thrown by hand → "throw".
  COMBOS CAN BE ANYTHING — encode them as beats[] in ONE continuous motion (never two clips):
  "kick and cum" → beats: [{at:0.32,style:"kick"},{at:0.58,style:"spray",projectile:cum}]. NO flying.
  "fly and kick" → style "fly", airAction "kick" (aerial ONLY if fly/run/jump is in the prompt).
  "summon a dog and make it bite him" → style "spawn", summon:{kind:"dog",scale:0.75,attack:"bite"},
    beats: [{at:0.22,style:"cast",summon},{at:0.62,style:"spawn",summon,hits:true}].
  SUMMON SCALE MUST LOOK REAL next to the fighters (~person-sized):
    bird/drone ~0.3–0.6 · cat ~0.45 · dog ~0.7–0.9 · wolf ~0.9–1.1 · golem ~2–2.5 ·
    car ~4–5 · tank ~5–7 · truck ~6–9 · airplane/jet ~12–20 · airliner/jumbo ~22–30 ·
    THE SUN ~50–80 (sky-filling fireball — never a tennis ball).
  Never summon a plane or the sun at scale 1 — they must dwarf the fighters.
  Prefer attack "crash" for vehicles and celestial bodies.
  Use airAction ONLY when travel words (fly/run/jump) are present. "kick and cum" is ground beats.
  projectile { shape:"blob", color matching the liquid, scale ~0.7–1.1, splat:true, spin:true, name }.
  Creamy white for cum (#f5f0e1), yellow for piss, green for vomit, brown for poop.
  Liquids MUST still fly and SPLAT. Never classify liquid gags as "buff".
- reaction / force when damaging hits LAND. hits true if damage > 0; splat projectiles still fly at 0 dmg.
- opponentAnim: optional second choreography played ON THE DEFENDER at the same time
  (dodge slip, block brace, counter flourish). Use it for concurrent dodges/blocks.
- interruptOpponent: true only when the hit stops their current move.

FORGE phase: also invent agentUpdate {name, epithet, aura}.
storyBeat: 1–2 vivid present-tense sentences. Mention 0 damage / dodges plainly — but still
describe the liquid mess when there is one.
Output ONLY valid JSON. No markdown.`

function extractJson(text: string): Partial<ClashResolveResponse> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalize(
  parsed: Partial<ClashResolveResponse>,
  body: ClashResolveRequest,
  localUniq: number
): ClashResolveResponse {
  const fb = fallbackResolve(body);

  let action = (parsed.action || fb.action) as ActionKind;
  if (!ACTIONS.includes(action)) action = fb.action;
  if (action === "forge") action = inferAction(body.prompt);
  // Comedy liquids are never a "buff" / pure move — they throw goop
  if (isLiquidPrompt(body.prompt) && (action === "buff" || action === "move" || action === "heal")) {
    action = "attack";
  }

  let uniqueness = clamp(Math.round(Number(parsed.uniqueness)), 0, 100);
  if (!Number.isFinite(uniqueness)) uniqueness = localUniq;
  if (isRepeatPrompt(body.prompt, body.priorPrompts)) {
    uniqueness = Math.min(uniqueness, 15);
  }
  const wordCount = body.prompt.trim().split(/\s+/).length;
  if (wordCount <= 2 && localUniq < 25) uniqueness = Math.min(uniqueness, 30);

  let damage = clamp(Math.round(Number(parsed.damage) || 0), MIN_DAMAGE, MAX_DAMAGE);
  let blockMs = parsed.blockMs != null ? Number(parsed.blockMs) : fb.blockMs;
  let blockPower =
    parsed.blockPower != null ? Number(parsed.blockPower) : fb.blockPower;

  const nonDamaging =
    action === "block" ||
    action === "dodge" ||
    action === "move" ||
    action === "heal" ||
    action === "buff";

  if (nonDamaging) damage = 0;

  if (action === "block") {
    blockMs = clamp(blockMs || fb.blockMs || 2500, 1200, 7000);
    blockPower = clamp(blockPower || fb.blockPower || 0.7, 0.4, 1);
  }

  if (!nonDamaging) {
    const cap =
      uniqueness < 25 ? 2 : uniqueness < 50 ? 5 : uniqueness < 75 ? 8 : 10;
    damage = Math.min(damage, cap);
  }

  const speedBonus = clamp(Number(parsed.speedBonus) || fb.speedBonus, 0, 2);

  let storyBeat =
    typeof parsed.storyBeat === "string" && parsed.storyBeat.trim()
      ? parsed.storyBeat.trim()
      : fb.storyBeat;
  if (nonDamaging && /\d+\s*(hp|damage)/i.test(storyBeat)) {
    storyBeat = fb.storyBeat;
  }

  let clash: ClashOutcome =
    parsed.clash && CLASH_OUTCOMES.includes(parsed.clash)
      ? parsed.clash
      : fb.clash || "none";

  const oppActive =
    body.player === 1 ? body.active2 : body.active1;
  const oppLive = !!(oppActive && oppActive.until > Date.now() - 500);

  // Soft outcomes never deal damage
  if (clash === "dodge" || clash === "block" || clash === "whiff") {
    damage = 0;
  }

  const finalDamage = clamp(damage, MIN_DAMAGE, MAX_DAMAGE);
  const localAnim = inferAnim(body.prompt, action, finalDamage);
  let anim = mergeAnim(parsed.anim, localAnim, finalDamage);
  // Strip bogus aerial flags — "kick and cum" must NOT fly
  if (!isAerialCombo(body.prompt)) {
    if (anim.airAction) anim = { ...anim, airAction: undefined };
    if (
      (anim.style === "fly" || anim.style === "run") &&
      (localAnim.beats || inferComboBeats(body.prompt, finalDamage))
    ) {
      anim = { ...anim, style: localAnim.style || "kick" };
    }
  }

  // Freeform ground combos (kick+cum, summon+bite, …)
  {
    const beats =
      (Array.isArray(anim.beats) && anim.beats.length >= 2 ? anim.beats : null) ||
      localAnim.beats ||
      inferComboBeats(body.prompt, finalDamage);
    const inferred = inferSummon(body.prompt);
    const fromAi = validSummon(anim.summon);
    const fromLocal = validSummon(localAnim.summon) || inferred;
    // Prefer literal inferred kind/scale so "sun"/"airplane" can't stay a toy generic blob
    const summon =
      inferred &&
      (inferred.kind === "sun" ||
        inferred.kind === "plane" ||
        inferred.kind === "car" ||
        inferred.kind === "truck" ||
        inferred.kind === "tank")
        ? {
            ...(fromAi || fromLocal || inferred),
            kind: inferred.kind,
            scale: Math.max(fromAi?.scale || 0, fromLocal?.scale || 0, inferred.scale),
            attack: inferred.attack || "crash",
            color: inferred.color,
            name: inferred.name || inferred.kind,
          }
        : fromAi || fromLocal || null;
    if (beats && beats.length >= 2 && !isAerialCombo(body.prompt)) {
      anim = {
        ...anim,
        style: beats[0].style,
        beats: normalizeBeats(beats, finalDamage),
        intensity: Math.max(anim.intensity || 0.5, 0.8),
        hits: finalDamage > 0,
        airAction: undefined,
        summon: summon || beats.find((b) => b.summon)?.summon || null,
        projectile:
          beats.find((b) => b.projectile)?.projectile || anim.projectile || localAnim.projectile,
        reaction: finalDamage > 0 ? anim.reaction || localAnim.reaction || "stagger" : "none",
        force: finalDamage > 0 ? anim.force || localAnim.force || 0.55 : 0,
      };
    } else if (summon) {
      anim = {
        ...anim,
        style: anim.style === "buff" || anim.style === "flourish" ? "spawn" : anim.style,
        summon,
        beats:
          anim.beats && anim.beats.length >= 2
            ? normalizeBeats(anim.beats, finalDamage)
            : [
                { at: 0.22, style: "cast", summon, hits: false },
                { at: 0.62, style: "spawn", summon, hits: finalDamage > 0 },
              ],
        hits: finalDamage > 0,
      };
    }
  }

  // Aerial combos ONLY when travel words are present
  {
    const air = isAerialCombo(body.prompt)
      ? inferAirAction(body.prompt) || anim.airAction || localAnim.airAction || null
      : null;
    if (air && isAerialCombo(body.prompt)) {
      const travel: AnimStyle =
        anim.style === "fly" || anim.style === "run" || anim.style === "jump"
          ? anim.style
          : localAnim.style === "fly" || localAnim.style === "run" || localAnim.style === "jump"
            ? localAnim.style
            : /jump|leap/i.test(body.prompt)
              ? "jump"
              : /run|sprint|dash/i.test(body.prompt)
                ? "run"
                : "fly";
      anim = {
        ...anim,
        style: travel,
        airAction: air,
        beats: undefined,
        intensity: Math.max(anim.intensity || 0.5, localAnim.intensity || 0.5, 0.85),
        hits: finalDamage > 0,
        laps: anim.laps || localAnim.laps || 0.85,
        radius: anim.radius || localAnim.radius || 2.2,
        projectile:
          air === "spray" || air === "throw" || air === "cast"
            ? anim.projectile || localAnim.projectile || {
                shape: "blob",
                color: "#f5f0e1",
                scale: 0.95,
                spin: true,
                splat: true,
                name: air === "spray" ? "cum" : "goop",
              }
            : anim.projectile ?? localAnim.projectile ?? null,
        limb:
          air === "kick" ? "rightLeg" : air === "spray" ? "both" : anim.limb || "rightArm",
        reaction: finalDamage > 0 ? anim.reaction || localAnim.reaction || "knockback" : "none",
        force: finalDamage > 0 ? anim.force || localAnim.force || 0.7 : 0,
      };
    }
  }

  // Always keep the liquid blob — the mess is the punchline
  if (isLiquidPrompt(body.prompt)) {
    const crotchSpray = /cum|jizz|semen|nut|spooge|piss|pee|urine/i.test(body.prompt);
    const liquidStyle = crotchSpray
      ? "spray"
      : /spit|vomit|puke|barf|drool/i.test(body.prompt)
        ? "cast"
        : "throw";
    const gooProj =
      anim.projectile?.splat
        ? { ...anim.projectile, splat: true as const }
        : localAnim.projectile || {
            shape: "blob" as const,
            color: crotchSpray ? "#f5f0e1" : "#7cbf3f",
            scale: 0.95,
            spin: true,
            splat: true,
            name: crotchSpray ? "cum" : "goop",
          };

    if (anim.beats && anim.beats.length >= 2) {
      const beats = anim.beats;
      let nextBeats = beats.map((b) =>
        b.style === "spray" || b.style === "throw" || b.style === "cast"
          ? { ...b, projectile: b.projectile || gooProj }
          : b
      );
      if (crotchSpray && !nextBeats.some((b) => b.style === "spray")) {
        nextBeats = [
          ...nextBeats,
          { at: 0.6, style: "spray", projectile: gooProj, hits: finalDamage > 0 },
        ];
      }
      anim = { ...anim, projectile: gooProj, beats: nextBeats };
    } else if (anim.airAction) {
      anim = {
        ...anim,
        projectile: gooProj,
        airAction: crotchSpray ? "spray" : anim.airAction,
      };
    } else if (crotchSpray) {
      anim = {
        style: "spray",
        limb: "both",
        projectile: gooProj,
        intensity: Math.max(anim.intensity || 0.5, 0.65),
        hits: finalDamage > 0,
        reaction: anim.reaction || localAnim.reaction,
        force: anim.force || localAnim.force,
      };
    } else {
      anim = {
        ...anim,
        style:
          anim.style === "buff" || anim.style === "flourish" || anim.style === "taunt"
            ? liquidStyle
            : anim.style,
        limb: anim.limb || "rightArm",
        projectile: gooProj,
      };
    }
  }
  // Dodged liquids still fly — they just miss / don't stick
  if ((clash === "dodge" || clash === "whiff") && anim.projectile) {
    anim = {
      ...anim,
      hits: false,
      projectile: { ...anim.projectile, splat: false },
    };
  }

  let interruptOpponent =
    parsed.interruptOpponent != null
      ? !!parsed.interruptOpponent
      : fb.interruptOpponent ?? false;
  if (finalDamage > 0 && oppLive && (clash === "hit" || clash === "interrupt" || clash === "clash")) {
    interruptOpponent = true;
  }
  if (clash === "dodge" || clash === "whiff" || finalDamage <= 0) {
    interruptOpponent = false;
  }

  let opponentAnim: AnimSpec | null | undefined =
    parsed.opponentAnim != null
      ? mergeAnim(parsed.opponentAnim, { style: "dodge", hits: false, intensity: 0.7 }, 0)
      : fb.opponentAnim;
  if (clash === "dodge" && !opponentAnim) {
    opponentAnim = { style: "dodge", intensity: 0.75, hits: false, radius: 1.9 };
  }
  if (clash === "block" && !opponentAnim) {
    opponentAnim = { style: "block", intensity: 0.7, hits: false };
  }
  // Landed hits use the reaction on `anim` — don't also play a dodge on the victim
  if (finalDamage > 0 || clash === "hit" || clash === "interrupt") {
    opponentAnim = undefined;
  }
  if (!oppLive && clash === "none") opponentAnim = undefined;

  let highlight = nonDamaging
    ? action === "move"
      ? body.phase === "forge"
        ? "FORGE"
        : "MOVE"
      : parsed.highlight || fb.highlight
    : parsed.highlight || fb.highlight;
  if (clash === "dodge") highlight = "DODGE";
  else if (clash === "whiff") highlight = "WHIFF";
  else if (clash === "block" && finalDamage === 0) highlight = "BLOCKED";

  return {
    action,
    damage: finalDamage,
    uniqueness,
    speedBonus,
    blockMs: blockMs || undefined,
    blockPower: blockPower || undefined,
    effectMs:
      parsed.effectMs != null
        ? clamp(Number(parsed.effectMs), 0, 10000)
        : fb.effectMs,
    effectLabel: parsed.effectLabel || fb.effectLabel,
    heal:
      parsed.heal != null
        ? clamp(Number(parsed.heal), 0, 12)
        : action === "heal"
          ? fb.heal
          : undefined,
    anim,
    opponentAnim: opponentAnim || undefined,
    clash,
    interruptOpponent: interruptOpponent || undefined,
    storyBeat,
    highlight,
    agentUpdate:
      body.phase === "forge" || parsed.agentUpdate
        ? {
            name: parsed.agentUpdate?.name || fb.agentUpdate?.name,
            epithet: parsed.agentUpdate?.epithet || fb.agentUpdate?.epithet,
            aura: parsed.agentUpdate?.aura || fb.agentUpdate?.aura,
            forged: true,
          }
        : undefined,
  };
}

function mergeAnim(
  ai: Partial<AnimSpec> | undefined,
  local: AnimSpec,
  damage: number
): AnimSpec {
  const style =
    ai?.style && ANIM_STYLES.includes(ai.style as AnimStyle)
      ? (ai.style as AnimStyle)
      : local.style;

  const reaction =
    damage <= 0
      ? "none"
      : ai?.reaction && REACTIONS.includes(ai.reaction) && ai.reaction !== "none"
        ? ai.reaction
        : local.reaction || "flinch";

  const airAction =
    (ai?.airAction && ANIM_STYLES.includes(ai.airAction as AnimStyle)
      ? (ai.airAction as AnimStyle)
      : null) ||
    local.airAction ||
    null;

  const merged: AnimSpec = {
    style,
    limb: ai?.limb || local.limb,
    intensity: clamp(Number(ai?.intensity) || local.intensity || 0.5, 0.15, 1),
    hits: damage > 0,
    projectile: null,
    prop: validProp(ai?.prop) || local.prop || null,
    laps: clamp(Number(ai?.laps) || local.laps || 0, 0, 3) || undefined,
    radius: clamp(Number(ai?.radius) || local.radius || 0, 0, 2.65) || undefined,
    reaction,
    force:
      damage <= 0 ? 0 : clamp(Number(ai?.force) || local.force || 0.5, 0.1, 1),
    airAction: airAction || undefined,
    summon: validSummon(ai?.summon) || validSummon(local.summon) || undefined,
    beats:
      Array.isArray(ai?.beats) && ai!.beats!.length >= 2
        ? normalizeBeats(ai!.beats!, damage)
        : local.beats && local.beats.length >= 2
          ? normalizeBeats(local.beats, damage)
          : undefined,
  };

  const p = ai?.projectile || local.projectile;
  if (p && typeof p === "object") {
    merged.projectile = {
      shape: PROJECTILE_SHAPES.includes(p.shape)
        ? p.shape
        : local.projectile?.shape || "sphere",
      color: HEX.test(String(p.color)) ? p.color : local.projectile?.color || "#ffe566",
      scale: clamp(Number(p.scale) || local.projectile?.scale || 0.7, 0.3, 2),
      spin: p.spin ?? local.projectile?.spin,
      trail: p.trail ?? local.projectile?.trail,
      splat: p.splat ?? (p.shape === "blob" || local.projectile?.splat),
      name: p.name || local.projectile?.name,
    };
  }

  return merged;
}

export async function POST(req: Request) {
  let body: ClashResolveRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.prompt || typeof body.prompt !== "string") {
    return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
  }
  if (body.player !== 1 && body.player !== 2) {
    return NextResponse.json({ error: "Invalid player" }, { status: 400 });
  }

  // Always have a sane local baseline
  body.priorPrompts = Array.isArray(body.priorPrompts) ? body.priorPrompts : [];
  body.status1 = body.status1 || {
    blockUntil: 0,
    blockPower: 0,
    flyingUntil: 0,
    buffUntil: 0,
    buffNote: "",
  };
  body.status2 = body.status2 || {
    blockUntil: 0,
    blockPower: 0,
    flyingUntil: 0,
    buffUntil: 0,
    buffNote: "",
  };

  const localUniq = scoreUniqueness(body.prompt, body.priorPrompts);

  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(normalize(fallbackResolve(body), body, localUniq));
  }

  const liveActive = (m: ClashResolveRequest["active1"]) =>
    m && m.until > Date.now() - 500 ? m : null;

  const userPayload = {
    player: body.player,
    attacker: agentLabel(body.player === 1 ? body.agent1 : body.agent2, body.player),
    defender: agentLabel(body.player === 1 ? body.agent2 : body.agent1, body.player === 1 ? 2 : 1),
    phase: body.phase,
    prompt: body.prompt,
    agent1: body.agent1,
    agent2: body.agent2,
    hp1: body.hp1,
    hp2: body.hp2,
    status1: body.status1,
    status2: body.status2,
    active1: liveActive(body.active1),
    active2: liveActive(body.active2),
    opponentCurrently: liveActive(body.player === 1 ? body.active2 : body.active1),
    priorPrompts: body.priorPrompts.slice(-16),
    recentStory: body.story.slice(-8),
    matchElapsedMs: body.matchElapsedMs,
    promptIndex: body.promptIndex,
    schema: {
      action: ACTIONS.join(" | "),
      damage: "0-10 int",
      uniqueness: "0-100 (be harsh on generics)",
      speedBonus: "0-2",
      blockMs: "ms if block",
      blockPower: "0-1 if block",
      effectMs: "optional",
      effectLabel: "optional short",
      heal: "optional",
      clash: CLASH_OUTCOMES.join("|"),
      interruptOpponent: "boolean — stop opponent's current move on a landed hit",
      opponentAnim: "optional AnimSpec played on defender concurrently (dodge/block)",
      anim: {
        style: ANIM_STYLES.join("|"),
        limb: "rightArm|leftArm|rightLeg|leftLeg|both|head",
        prop: "{kind,color,length} or null",
        projectile: "{shape,color,scale,spin,trail,splat,name} or null",
        laps: "0-3 (self movement only)",
        radius: "0-2.6",
        intensity: "0-1",
        hits: "boolean",
        reaction: REACTIONS.join("|"),
        force: "0-1",
        airAction: "ONLY with fly/run/jump — kick|punch|spray|…",
        beats: "[{at:0-1,style,projectile?,summon?,hits?}] multi-action combo",
        summon: "{kind:dog|wolf|cat|bird|blob|golem|drone|plane|car|truck|tank|sun|generic, color, scale (REALISTIC — sun ~58), attack, name}",
      },
      storyBeat: "1-2 sentences",
      highlight: "FORGE|HIT|CRITICAL|BLOCK|DODGE|MOVE|SPAWN|BUFF|HEAL|WHIFF|SPECIAL|BLOCKED",
      agentUpdate: "forge fields if forge phase",
    },
  };

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content: `Resolve. JSON only.\n${JSON.stringify(userPayload)}`,
            },
          ],
          temperature: 0.55,
          reasoning_effort: "low",
          max_completion_tokens: 1500,
          response_format: { type: "json_object" },
        }),
      }
    );

    const result = await response.json();
    if (!response.ok) {
      console.error("Groq clash error:", result);
      return NextResponse.json(normalize(fallbackResolve(body), body, localUniq));
    }

    const raw = result?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(raw) || fallbackResolve(body);
    return NextResponse.json(normalize(parsed, body, localUniq));
  } catch (err) {
    console.error("Clash resolve failed:", err);
    return NextResponse.json(normalize(fallbackResolve(body), body, localUniq));
  }
}
