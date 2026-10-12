import {
  MAX_DAMAGE,
  MIN_DAMAGE,
  clamp,
  type ActionKind,
  type AnimBeat,
  type AnimSpec,
  type AnimStyle,
  type AnimSummon,
  type ClashResolveRequest,
  type ClashResolveResponse,
} from "./clash";

const GENERIC_ONES = new Set([
  "punch",
  "kick",
  "hit",
  "attack",
  "strike",
  "fight",
  "slash",
  "smack",
  "jab",
  "boom",
  "pow",
  "defend",
  "defense",
  "defence",
  "block",
  "guard",
  "shield",
  "dodge",
  "run",
  "jump",
  "fly",
  "move",
  "dance",
  "heal",
  "buff",
  "shot",
  "shoot",
  "fire",
  "gun",
  "ball",
  "magic",
  "spell",
  "power",
  "strong",
  "win",
  "kill",
  "die",
]);

/** Pure expression / locomotion — never deals damage unless prompt also has hostile words */
const MOTION_WORDS = [
  "dance",
  "dancing",
  "groove",
  "boogie",
  "twirl",
  "spin",
  "waltz",
  "salsa",
  "tango",
  "shimmy",
  "sway",
  "prance",
  "strut",
  "pose",
  "flex",
  "taunt",
  "tease",
  "bow",
  "wave",
  "clap",
  "cheer",
  "sing",
  "hum",
  "laugh",
  "cry",
  "sleep",
  "nap",
  "wait",
  "stare",
  "look",
  "stand",
  "sit",
  "kneel",
  "stretch",
  "yoga",
  "meditate",
  "breathe",
  "walk",
  "jog",
  "run",
  "sprint",
  "dash",
  "circle",
  "orbit",
  "pace",
  "jump",
  "leap",
  "hop",
  "skip",
  "fly",
  "hover",
  "float",
  "soar",
  "glide",
  "swim",
  "roll",
  "cartwheel",
  "backflip",
  "flip",
];

const HOSTILE_WORDS = [
  "punch",
  "kick",
  "hit",
  "attack",
  "strike",
  "slash",
  "smash",
  "blast",
  "shoot",
  "stab",
  "bash",
  "crush",
  "kill",
  "harm",
  "damage",
  "hurt",
  "fireball",
  "laser",
  "missile",
  "explode",
  "throw",
  "hurl",
  "launch",
  "bite",
  "claw",
  "slam",
  "uppercut",
  "haymaker",
  "whip",
  "lash",
  "smack",
  "beat",
  "swing",
];

/** Words that point the move at the other fighter rather than yourself */
const TARGET_WORDS = ["him", "her", "them", "opponent", "enemy", "foe", "rival"];

/** Verbs that move the *opponent's* body */
const FLING_WORDS = [
  "send",
  "knock",
  "fling",
  "yeet",
  "launch",
  "toss",
  "push",
  "shove",
  "punt",
  "blast",
  "throw",
  "hurl",
  "slam",
  "drop",
  "trip",
  "sweep",
];

/** Gross / funny liquids — comedy gold, always a visible splat projectile */
const LIQUID_WORDS = [
  "cum",
  "jizz",
  "semen",
  "nut",
  "spooge",
  "piss",
  "pee",
  "urine",
  "spit",
  "vomit",
  "puke",
  "barf",
  "blood",
  "milk",
  "cream",
  "mayo",
  "mayonnaise",
  "soup",
  "soda",
  "juice",
  "water",
  "oil",
  "grease",
  "honey",
  "syrup",
  "sauce",
  "gravy",
  "tears",
  "sweat",
  "drool",
  "snot",
  "slime",
  "goo",
  "ooze",
  "poop",
  "poo",
  "dung",
  "mud",
  "paint",
  "ink",
  "custard",
  "pie",
];

export function isLiquidPrompt(prompt: string) {
  const t = tokens(prompt);
  if (hasAny(t, LIQUID_WORDS)) return true;
  // "X on him/her" → aimed goop even without a known liquid word
  return hasAny(t, TARGET_WORDS) && t.includes("on");
}

/** Cum / piss — sprays from the hips, not a hand-throw */
export function isCrotchSprayPrompt(prompt: string) {
  return hasAny(tokens(prompt), [
    "cum",
    "jizz",
    "semen",
    "nut",
    "spooge",
    "piss",
    "pee",
    "urine",
  ]);
}

function tokens(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** "fly" matches fly/flying/flies-ish forms, never unrelated words that merely contain it. */
function wordMatches(word: string, key: string) {
  if (word === key) return true;
  if (key.endsWith("e") && word.startsWith(key.slice(0, -1))) {
    if (/^(ing|ed|er|ers)$/.test(word.slice(key.length - 1))) return true;
  }
  if (!word.startsWith(key)) return false;
  const rest = word.slice(key.length);
  const last = key[key.length - 1];
  return new RegExp(`^${last}?(s|es|ed|d|ing|er|ers|y|ies)$`).test(rest);
}

function hasAny(words: string[], keys: string[]) {
  const joined = ` ${words.join(" ")} `;
  return keys.some((k) =>
    k.includes(" ") ? joined.includes(` ${k} `) : words.some((w) => wordMatches(w, k))
  );
}

export function targetsOpponent(prompt: string) {
  return hasAny(tokens(prompt), TARGET_WORDS);
}

export function isRepeatPrompt(prompt: string, priors: string[]) {
  const norm = prompt.toLowerCase().trim();
  return priors.some((p) => {
    const pn = p.toLowerCase().trim();
    return pn === norm || (pn.length > 3 && (pn.includes(norm) || norm.includes(pn)));
  });
}

/** Local uniqueness: generic one-word prompts score low; repeats crater. */
export function scoreUniqueness(prompt: string, priors: string[]): number {
  const raw = prompt.trim();
  const norm = raw.toLowerCase();
  const words = tokens(norm);
  if (!words.length) return 0;

  let score = 18;
  score += Math.min(28, raw.length / 2.2);
  score += Math.min(22, words.length * 7);

  const rare = words.filter((w) => w.length > 5 && !GENERIC_ONES.has(w));
  score += Math.min(20, rare.length * 8);

  for (const p of priors) {
    const pn = p.toLowerCase().trim();
    if (!pn) continue;
    if (pn === norm) score -= 55;
    else if (pn.includes(norm) || norm.includes(pn)) score -= 28;
    else {
      const overlap = words.filter((w) => tokens(pn).includes(w)).length;
      if (overlap >= Math.max(1, Math.ceil(words.length * 0.6))) score -= 18;
    }
  }

  if (words.length === 1 && GENERIC_ONES.has(words[0])) score = Math.min(score, 14);
  if (words.length <= 2 && words.every((w) => GENERIC_ONES.has(w))) {
    score = Math.min(score, 22);
  }

  if (words.length === 1) {
    for (const g of GENERIC_ONES) {
      if (levApprox(words[0], g) <= 1) score = Math.min(score, 16);
    }
  }

  return clamp(Math.round(score), 0, 100);
}

function levApprox(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return 99;
  if (a === b) return 0;
  let diffs = 0;
  const max = Math.max(a.length, b.length);
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i++) if (a[i] !== b[i]) diffs++;
  return diffs + (max - min);
}

export function isHostilePrompt(prompt: string): boolean {
  const t = tokens(prompt);
  if (hasAny(t, HOSTILE_WORDS)) return true;
  return hasAny(t, TARGET_WORDS) && hasAny(t, FLING_WORDS);
}

export function isPureMotion(prompt: string): boolean {
  const t = tokens(prompt);
  if (!t.length) return false;
  if (isHostilePrompt(prompt)) return false;
  // "fly and cum on him" is NOT pure motion — liquid / aimed goop wins
  if (isLiquidPrompt(prompt)) return false;
  // single motion word, or motion-only phrase
  if (t.length === 1 && MOTION_WORDS.some((m) => levApprox(t[0], m) <= 1 || t[0].startsWith(m.slice(0, 4)))) {
    return true;
  }
  return hasAny(t, MOTION_WORDS) && !isHostilePrompt(prompt);
}

const TRAVEL_WORDS = [
  "fly",
  "hover",
  "soar",
  "glide",
  "levitate",
  "run",
  "sprint",
  "dash",
  "jump",
  "leap",
  "vault",
];

/** Prompt mixes travel (fly/run/jump) with an attack — one merged aerial motion */
export function inferAirAction(prompt: string): AnimStyle | null {
  const t = tokens(prompt);
  if (!hasAny(t, TRAVEL_WORDS)) return null;
  if (isCrotchSprayPrompt(prompt)) return "spray";
  if (isLiquidPrompt(prompt)) {
    if (hasAny(t, ["spit", "vomit", "puke", "barf", "drool"])) return "cast";
    return "throw";
  }
  if (hasAny(t, ["kick", "knee", "boot", "roundhouse"])) return "kick";
  if (hasAny(t, ["punch", "jab", "hook", "uppercut", "fist"])) return "punch";
  if (hasAny(t, ["whip", "lash", "belt", "slash", "swipe", "cut"])) return "whip";
  if (hasAny(t, ["slam", "stomp", "smash"])) return "slam";
  if (hasAny(t, ["shove", "push", "shoulder"])) return "shove";
  if (hasAny(t, HOSTILE_WORDS)) return "punch";
  return null;
}

export function isAerialCombo(prompt: string) {
  return inferAirAction(prompt) != null;
}

export function inferSummon(prompt: string): AnimSummon | null {
  const t = tokens(prompt);
  const has = (...keys: string[]) => hasAny(t, keys);
  const lower = prompt.toLowerCase();
  const thing = has(
    "dog",
    "wolf",
    "cat",
    "bird",
    "drone",
    "golem",
    "pet",
    "beast",
    "creature",
    "minion",
    "familiar",
    "hound",
    "puppy",
    "eagle",
    "hawk",
    "plane",
    "airplane",
    "aeroplane",
    "jet",
    "airliner",
    "boeing",
    "aircraft",
    "car",
    "truck",
    "tank",
    "bus",
    "van",
    "helicopter",
    "sun",
    "solar",
    "sunshine",
    "sunlight"
  );
  const verb = has("summon", "spawn", "call", "unleash", "release", "conjure");
  if (!thing && !verb) return null;
  if (!thing && verb && !has("minion", "familiar", "pet", "beast", "creature")) return null;

  let kind: AnimSummon["kind"] = "generic";
  if (has("sun", "solar", "sunshine", "sunlight") || /\bthe sun\b/.test(lower)) kind = "sun";
  else if (has("plane", "airplane", "aeroplane", "jet", "airliner", "boeing", "aircraft", "helicopter"))
    kind = "plane";
  else if (has("truck", "bus", "lorry", "semi")) kind = "truck";
  else if (has("tank")) kind = "tank";
  else if (has("car", "van", "vehicle", "automobile")) kind = "car";
  else if (has("dog", "hound", "puppy", "pup")) kind = "dog";
  else if (has("wolf")) kind = "wolf";
  else if (has("cat", "kitten")) kind = "cat";
  else if (has("bird", "eagle", "hawk", "crow")) kind = "bird";
  else if (has("drone", "bot", "robot")) kind = "drone";
  else if (has("golem", "rock", "stone", "giant")) kind = "golem";
  else if (has("slime", "blob")) kind = "blob";

  let attack: AnimSummon["attack"] = "tackle";
  if (kind === "sun") attack = "crash";
  else if (kind === "plane" || kind === "truck" || kind === "tank" || kind === "car") attack = "crash";
  else if (has("bite", "chomp", "maul", "gnaw")) attack = "bite";
  else if (has("slash", "claw", "scratch")) attack = "slash";
  else if (has("ram", "charge", "headbutt")) attack = "ram";
  else if (has("shoot", "laser", "fire")) attack = "shoot";

  const colors: Record<AnimSummon["kind"], string> = {
    dog: "#8b5a2b",
    wolf: "#6b7280",
    cat: "#d4a017",
    bird: "#4a90a4",
    drone: "#9ca3af",
    golem: "#78716c",
    blob: "#7cbf3f",
    plane: "#d6dde6",
    car: "#c45c26",
    truck: "#4a5568",
    tank: "#5c6b4a",
    sun: "#ffb020",
    generic: "#a65b3b",
  };

  // Realistic size vs ~2-unit fighters — sun fills the sky
  let scale =
    kind === "bird"
      ? 0.35
      : kind === "cat"
        ? 0.45
        : kind === "drone"
          ? 0.5
          : kind === "dog"
            ? 0.75
            : kind === "wolf"
              ? 0.95
              : kind === "blob"
                ? 0.9
                : kind === "golem"
                  ? 2.2
                  : kind === "car"
                    ? 4.2
                    : kind === "tank"
                      ? 5.5
                      : kind === "truck"
                        ? 7
                        : kind === "plane"
                          ? 14
                          : kind === "sun"
                            ? 58
                            : 1.2;

  if (kind === "sun") {
    if (/tiny|toy|mini|small/.test(lower)) scale = 28;
    else if (/dwarf|red dwarf/.test(lower)) scale = 36;
    else if (/huge|massive|giant|colossal|enormous|blazing/.test(lower)) scale = 72;
    else scale = 58;
  }
  if (kind === "plane") {
    if (/jumbo|airliner|boeing|747|a380|huge|massive|giant/.test(lower)) scale = 24;
    else if (/jet|fighter|f-16|f16/.test(lower)) scale = 11;
    else if (/tiny|toy|mini/.test(lower)) scale = 8;
    else scale = 14;
  }
  if (kind === "golem" && /giant|huge|massive|colossal/.test(lower)) scale = 3.8;
  if ((kind === "dog" || kind === "wolf") && /giant|huge|massive/.test(lower)) scale *= 2.4;

  return {
    kind,
    color: colors[kind],
    scale,
    name: kind === "plane" ? (/jet/.test(lower) ? "jet" : "airplane") : kind === "sun" ? "the sun" : kind,
    attack,
  };
}

/** Ground / freeform multi-action combo — kick+spray, punch+throw, etc. (NOT aerial) */
export function inferComboBeats(prompt: string, damage: number): AnimBeat[] | null {
  const t = tokens(prompt);
  const has = (...keys: string[]) => hasAny(t, keys);
  // Aerial handled separately
  if (hasAny(t, TRAVEL_WORDS)) return null;

  const beats: AnimBeat[] = [];
  const hits = damage > 0;
  const summon = inferSummon(prompt);

  if (summon) {
    beats.push({ at: 0.22, style: "cast", summon, hits: false });
    beats.push({
      at: 0.62,
      style: "spawn",
      summon,
      hits,
    });
    return beats;
  }

  if (has("kick", "knee", "boot", "roundhouse")) {
    beats.push({ at: 0.32, style: "kick", hits });
  }
  if (has("punch", "jab", "hook", "uppercut", "fist")) {
    beats.push({ at: beats.length ? 0.28 : 0.35, style: "punch", hits });
  }
  if (has("whip", "lash", "belt") || has("slash", "swipe")) {
    beats.push({ at: 0.4, style: has("whip", "lash", "belt") ? "whip" : "slash", hits });
  }
  if (has("shove", "push")) beats.push({ at: 0.38, style: "shove", hits });
  if (has("slam", "stomp")) beats.push({ at: 0.45, style: "slam", hits });

  if (isCrotchSprayPrompt(prompt)) {
    beats.push({
      at: beats.length ? 0.58 : 0.45,
      style: "spray",
      hits,
      projectile: {
        shape: "blob",
        color: "#f5f0e1",
        scale: 0.95,
        spin: true,
        splat: true,
        name: "cum",
      },
    });
  } else if (isLiquidPrompt(prompt)) {
    const spit = has("spit", "vomit", "puke", "barf");
    beats.push({
      at: beats.length ? 0.58 : 0.45,
      style: spit ? "cast" : "throw",
      hits,
      projectile: {
        shape: "blob",
        color: spit ? "#8fbf3f" : "#5b3a1e",
        scale: 0.85,
        spin: true,
        splat: true,
        name: spit ? "goop" : "poop",
      },
    });
  }

  if (has("block", "defend", "guard") && beats.length) {
    beats.push({ at: 0.15, style: "block", hits: false });
  }

  // Need at least 2 distinct actions to count as a combo
  const styles = new Set(beats.map((b) => b.style));
  if (beats.length >= 2 && styles.size >= 2) {
    beats.sort((a, b) => a.at - b.at);
    return beats;
  }
  return null;
}

/** @deprecated use isAerialCombo */
export function isMotionThenLiquid(prompt: string) {
  return isLiquidPrompt(prompt) && hasAny(tokens(prompt), TRAVEL_WORDS);
}

/**
 * What the prompt *does* in the ring — independent of forge phase.
 * Forge still creates the agent; it must not force every forge into an attack.
 */
export function inferAction(prompt: string): ActionKind {
  const t = tokens(prompt);
  const has = (...keys: string[]) => hasAny(t, keys);

  if (has("defend", "defense", "defence", "block", "guard", "parry", "shield", "tank")) {
    return "block";
  }
  if (has("dodge", "evade", "sidestep", "duck", "weave")) return "dodge";
  if (has("heal", "regen", "restore", "mend")) return "heal";
  if (has("buff", "empower", "enrage", "powerup")) return "buff";

  // Gross liquids / "on him" always count as an attack (even "fly and cum…")
  if (isLiquidPrompt(prompt)) return "attack";
  // Summoned creatures that attack count as attacks
  if (inferSummon(prompt) && has("bite", "attack", "kill", "maul", "chomp", "fight", "on")) {
    return "attack";
  }

  if (isPureMotion(prompt)) return "move";

  if (has("spawn", "summon", "create", "equip", "build", "craft", "gun", "cannon", "wand") || inferSummon(prompt)) {
    return "spawn";
  }
  if (has("bubble", "fireball", "laser", "missile", "projectile", "throw", "hurl", "launch")) {
    return has("bubble", "shield", "wall") && !has("throw", "hurl", "shoot", "fire")
      ? "spawn"
      : "attack";
  }
  if (isHostilePrompt(prompt)) return "attack";

  // Descriptive forge of a character with no verb → special identity, no hit
  if (
    !hasAny(t, HOSTILE_WORDS) &&
    !hasAny(t, MOTION_WORDS) &&
    !isLiquidPrompt(prompt) &&
    t.length <= 3
  ) {
    return "buff"; // flavor presence, not a strike
  }

  return t.length >= 3 ? "special" : "attack";
}

/** Offline fallback choreography — the AI's `anim` is preferred when available. */
export function inferAnim(prompt: string, action: ActionKind, damage: number): AnimSpec {
  const spec = baseAnim(prompt, action, damage);
  return { ...spec, ...inferReaction(prompt, spec, damage) };
}

function inferReaction(
  prompt: string,
  spec: AnimSpec,
  damage: number
): Pick<AnimSpec, "reaction" | "force"> {
  if (damage <= 0) return { reaction: "none", force: 0 };
  const t = tokens(prompt);
  const has = (...keys: string[]) => hasAny(t, keys);
  const force = clamp(0.35 + damage / 14, 0.35, 1);

  if (
    has(
      "flying",
      "launch",
      "fling",
      "yeet",
      "punt",
      "sky",
      "moon",
      "space",
      "orbit",
      "out of the ring",
      "never returns",
      "never return",
      "far away"
    )
  ) {
    return { reaction: "launch", force: Math.max(force, 0.85) };
  }
  if (has("trip", "sweep", "floor", "knock down", "knocked down", "drop", "flatten")) {
    return { reaction: "knockdown", force };
  }
  if (spec.style === "slam") return { reaction: "knockdown", force };
  if (has("spin", "twist", "tornado", "whirl")) return { reaction: "spin", force };
  if (has("push", "shove", "send", "knock", "blast")) {
    return { reaction: "knockback", force: Math.max(force, 0.6) };
  }
  if (spec.style === "kick" && damage >= 5) return { reaction: "knockback", force };
  if (damage >= 7) return { reaction: "knockback", force };
  if (damage >= 4) return { reaction: "stagger", force };
  return { reaction: "flinch", force };
}

function baseAnim(prompt: string, action: ActionKind, damage: number): AnimSpec {
  const t = tokens(prompt);
  const has = (...keys: string[]) => hasAny(t, keys);
  const intensity = clamp(damage / 10 || (action === "move" ? 0.55 : 0.4), 0.25, 1);
  const hits = damage > 0;

  const propFromPrompt = (): AnimSpec["prop"] => {
    if (has("belt")) return { kind: "belt", color: "#1a1814", length: 1.35 };
    if (has("whip", "lash")) return { kind: "whip", color: "#5c3a21", length: 1.6 };
    if (has("chain")) return { kind: "chain", color: "#9ca3af", length: 1.4 };
    if (has("rope", "lasso")) return { kind: "rope", color: "#c4a574", length: 1.5 };
    if (has("bat", "club", "pipe")) return { kind: "bat", color: "#6b4423", length: 1.1 };
    if (has("sword", "blade", "katana", "saber"))
      return { kind: "sword", color: "#c0c8d4", length: 1.2 };
    if (has("staff", "stick", "pole")) return { kind: "staff", color: "#8b6914", length: 1.5 };
    if (has("hit with", "strike with", "smack with", "whip with", "beat with")) {
      return { kind: "generic", color: "#4a453c", length: 1.2 };
    }
    return null;
  };

  const projFromPrompt = (): AnimSpec["projectile"] => {
    if (has("cum", "jizz", "semen", "nut", "spooge", "cream")) {
      return { shape: "blob", color: "#f5f0e1", scale: 0.95, spin: true, splat: true, name: "cum" };
    }
    if (has("piss", "pee", "urine")) {
      return { shape: "blob", color: "#e8c84a", scale: 0.7, trail: true, splat: true, name: "piss" };
    }
    if (has("spit", "drool")) {
      return { shape: "blob", color: "#c8e8e0", scale: 0.55, splat: true, name: "spit" };
    }
    if (has("vomit", "puke", "barf")) {
      return { shape: "blob", color: "#8fbf3f", scale: 1.0, spin: true, splat: true, name: "vomit" };
    }
    if (has("blood")) {
      return { shape: "blob", color: "#a11a1a", scale: 0.7, splat: true, name: "blood" };
    }
    if (has("milk", "mayo", "mayonnaise")) {
      return { shape: "blob", color: "#f7f4ea", scale: 0.85, splat: true, name: "milk" };
    }
    if (has("soup", "gravy", "sauce", "ketchup")) {
      return { shape: "blob", color: "#c45c26", scale: 0.8, splat: true, name: "soup" };
    }
    if (has("honey", "syrup", "oil", "grease")) {
      return { shape: "blob", color: "#d4a017", scale: 0.75, splat: true, name: "goop" };
    }
    if (has("water", "juice", "soda", "tears", "sweat")) {
      return { shape: "blob", color: "#7ec8ff", scale: 0.65, trail: true, splat: true, name: "liquid" };
    }
    if (has("poop", "poo", "dung", "manure", "mud", "dirt")) {
      return { shape: "blob", color: "#5b3a1e", scale: 0.8, spin: true, splat: true, name: "poop" };
    }
    if (has("slime", "goo", "snot", "ooze", "jelly")) {
      return { shape: "blob", color: "#7cbf3f", scale: 0.8, splat: true, name: "slime" };
    }
    if (has("paint", "ink", "pie", "custard")) {
      return { shape: "blob", color: has("ink") ? "#1e1b4b" : "#e04b4b", scale: 0.75, splat: true, name: "splat" };
    }
    // "something on him" with no named liquid → generic white-ish goop
    if (has(...TARGET_WORDS) && t.includes("on")) {
      return { shape: "blob", color: "#f5f0e1", scale: 0.85, spin: true, splat: true, name: "goop" };
    }
    if (has("brick", "rock", "stone", "boulder")) {
      return { shape: "box", color: "#a65b3b", scale: has("boulder") ? 1.4 : 0.85, spin: true, name: "brick" };
    }
    if (has("bubble", "soap")) {
      return { shape: "sphere", color: "#9ad7ff", scale: 0.7, trail: true, name: "bubble" };
    }
    if (has("fireball", "flame", "meteor") || (has("fire") && has("ball"))) {
      return { shape: "sphere", color: "#ff6b2d", scale: 0.9, trail: true, name: "fireball" };
    }
    if (has("laser", "beam", "ray")) {
      return { shape: "cylinder", color: "#ff4d6d", scale: 0.55, trail: true, name: "laser" };
    }
    if (has("shuriken", "disc", "frisbee")) {
      return { shape: "torus", color: "#c0c4cc", scale: 0.7, spin: true, name: "disc" };
    }
    if (has("arrow", "spear", "javelin", "dart")) {
      return { shape: "cone", color: "#d4a574", scale: 0.75, name: "arrow" };
    }
    if (has("bomb", "grenade", "egg")) {
      return { shape: "sphere", color: "#2d2a26", scale: 0.65, name: "bomb" };
    }
    if (has("ball", "orb", "sphere")) {
      return { shape: "sphere", color: "#ffe566", scale: 0.7, name: "ball" };
    }
    if (has("gun", "shoot", "blast", "missile", "rocket")) {
      return { shape: "cone", color: "#ff8844", scale: 0.7, trail: true, name: "shot" };
    }
    if (has("throw", "hurl", "toss", "lob", "chuck", "yeet", "launch")) {
      return { shape: "box", color: "#c4a35a", scale: 0.7, spin: true, name: "thrown" };
    }
    return null;
  };

  const prop = propFromPrompt();
  const aroundRing =
    has("around", "circle", "orbit", "lap", "ring", "perimeter", "whole") ||
    has("run around", "running around");

  if (action === "block" || has("defend", "guard", "block", "parry", "shield")) {
    return { style: "block", limb: "both", intensity, hits: false };
  }
  if (action === "dodge" || has("dodge", "evade", "sidestep")) {
    return { style: "dodge", intensity, hits: false, radius: 1.8 };
  }
  if (action === "heal" || has("heal", "mend")) {
    return { style: "heal", limb: "both", intensity, hits: false };
  }
  // "send him flying", "knock her across the ring" — the opponent moves, not us
  if (has(...TARGET_WORDS) && has(...FLING_WORDS) && !projFromPrompt()) {
    if (has("kick", "punt", "boot")) return { style: "kick", limb: "rightLeg", intensity, hits };
    if (has("slam", "drop")) return { style: "slam", limb: "both", intensity, hits };
    if (has("punch", "uppercut")) return { style: "punch", limb: "rightArm", intensity, hits };
    return { style: "shove", limb: "both", intensity: Math.max(intensity, 0.6), hits };
  }
  if (has("dance", "groove", "boogie", "waltz", "tango", "salsa", "twirl")) {
    return { style: "dance", intensity: Math.max(intensity, 0.6), hits: false, laps: 1, radius: 1.2 };
  }
  // Freeform multi-action combos on the ground (kick+cum, punch+throw, summon+bite…)
  const comboBeats = inferComboBeats(prompt, damage);
  if (comboBeats) {
    const summon = comboBeats.find((b) => b.summon)?.summon || inferSummon(prompt);
    const proj = comboBeats.find((b) => b.projectile)?.projectile || null;
    return {
      style: comboBeats[0].style,
      limb: comboBeats.some((b) => b.style === "kick")
        ? "rightLeg"
        : comboBeats.some((b) => b.style === "spray")
          ? "both"
          : "rightArm",
      intensity: Math.max(intensity, 0.8),
      hits,
      beats: comboBeats,
      projectile: proj,
      summon: summon || null,
    };
  }

  // "fly and kick" / "fly then cum" — ONE merged aerial motion (not two clips)
  const airAction = inferAirAction(prompt);
  if (airAction) {
    const flying = has("fly", "hover", "soar", "levitate", "glide");
    const jumping = has("jump", "leap", "vault");
    const goo =
      airAction === "spray" || airAction === "throw" || airAction === "cast"
        ? projFromPrompt() || {
            shape: "blob" as const,
            color: "#f5f0e1",
            scale: 0.95,
            spin: true,
            splat: true,
            name: airAction === "spray" ? "cum" : "goop",
          }
        : null;
    return {
      style: flying ? "fly" : jumping ? "jump" : "run",
      limb: airAction === "kick" ? "rightLeg" : airAction === "spray" ? "both" : "rightArm",
      intensity: Math.max(intensity, 0.85),
      hits,
      laps: flying ? 0.85 : aroundRing ? 1.2 : 0.9,
      radius: flying ? 2.2 : aroundRing ? 2.5 : 2.0,
      airAction,
      projectile: goo,
    };
  }

  if (has("fly", "hover", "soar", "levitate", "glide")) {
    return {
      style: "fly",
      intensity: Math.max(intensity, 0.7),
      hits: false,
      laps: aroundRing ? 1.25 : 0.85,
      radius: aroundRing ? 2.55 : 2.0,
    };
  }
  if (has("jump", "leap", "hop", "vault")) {
    return { style: "jump", limb: "both", intensity, hits };
  }
  if (has("run", "sprint", "dash", "circle", "pace", "jog") || (action === "move" && aroundRing)) {
    return {
      style: "run",
      intensity: Math.max(intensity, 0.65),
      hits: false,
      laps: aroundRing || has("around") ? 1.75 : 1.25,
      radius: 2.65,
    };
  }

  // Melee props: belt / whip / bat — swing arc that reaches opponent
  if (prop && (has("hit", "strike", "smack", "whip", "lash", "beat", "slap", "swing", "with") || hits)) {
    return {
      style: prop.kind === "belt" || prop.kind === "whip" || prop.kind === "chain" || prop.kind === "rope"
        ? "whip"
        : "slash",
      limb: "rightArm",
      prop,
      intensity: Math.max(intensity, 0.55),
      hits,
    };
  }
  if (prop) {
    return { style: "whip", limb: "rightArm", prop, intensity, hits };
  }

  if (has("taunt", "flex", "pose", "bow", "wave")) {
    return { style: "taunt", limb: "rightArm", intensity, hits: false };
  }
  if (has("kick", "knee", "boot", "roundhouse")) {
    return { style: "kick", limb: "rightLeg", intensity, hits };
  }
  if (has("punch", "jab", "hook", "uppercut", "fist", "smack", "slap")) {
    return { style: "punch", limb: "rightArm", intensity, hits };
  }
  if (has("slash", "sword", "cut", "blade", "swipe")) {
    return {
      style: "slash",
      limb: "rightArm",
      prop: prop || { kind: "sword", color: "#c0c8d4", length: 1.15 },
      intensity,
      hits,
    };
  }
  if (has("slam", "stomp", "ground pound", "smash down")) {
    return { style: "slam", limb: "both", intensity, hits };
  }

  const projectile = projFromPrompt();
  // Cum / piss: hip thrust spray from the bottom — never a hand-throw
  if (isCrotchSprayPrompt(prompt) && projectile) {
    return {
      style: "spray",
      limb: "both",
      projectile,
      intensity: Math.max(intensity, 0.65),
      hits,
    };
  }
  if (has("shoot", "blast", "fireball", "laser", "gun") && projectile) {
    return { style: "shoot", limb: "rightArm", projectile, intensity, hits };
  }
  if (has("spit", "vomit", "puke", "barf", "drool") && projectile) {
    return { style: "cast", limb: "head", projectile, intensity, hits };
  }
  if ((has("throw", "hurl", "toss", "lob", "chuck", "yeet", "launch") || projectile) && projectile) {
    return { style: "throw", limb: "rightArm", projectile, intensity, hits };
  }
  if (action === "spawn") {
    return {
      style: "spawn",
      limb: "both",
      projectile: projectile || { shape: "sphere", color: "#b8924a", scale: 0.8, name: "spawn" },
      intensity,
      hits,
    };
  }
  if (action === "buff") {
    return { style: "buff", limb: "both", intensity, hits: false };
  }
  if (action === "move") {
    return { style: "run", intensity: 0.6, hits: false, laps: 1.4, radius: 2.65 };
  }
  if (has("cast", "spell", "magic", "summon")) {
    return {
      style: "cast",
      limb: "rightArm",
      projectile: projectile || { shape: "sphere", color: "#c084fc", scale: 0.65, trail: true, name: "bolt" },
      intensity,
      hits,
    };
  }

  return { style: hits ? "punch" : "flourish", limb: "rightArm", intensity, hits };
}

export function fallbackResolve(body: ClashResolveRequest): ClashResolveResponse {
  const uniqueness = scoreUniqueness(body.prompt, body.priorPrompts);
  const action = inferAction(body.prompt);
  const speedBonus = clamp(
    (body.promptIndex < 4 ? 1 : 0) + (body.matchElapsedMs < 25_000 ? 1 : 0),
    0,
    2
  );

  let damage = 0;
  let blockMs = 0;
  let blockPower = 0;
  let effectMs = 0;
  let effectLabel = "";
  let heal = 0;
  let highlight = "HIT";

  if (action === "block") {
    blockMs = clamp(Math.round(1800 + uniqueness * 35 + speedBonus * 400), 1500, 6000);
    blockPower = clamp(0.55 + uniqueness / 200, 0.5, 1);
    damage = 0;
    highlight = body.phase === "forge" ? "FORGE" : "BLOCK";
  } else if (action === "dodge" || action === "move") {
    effectMs = clamp(Math.round(1200 + uniqueness * 25), 1000, 4500);
    const lower = body.prompt.toLowerCase();
    effectLabel = lower.includes("dance")
      ? "dancing"
      : lower.includes("fly")
        ? "airborne"
        : action === "dodge"
          ? "evasive"
          : "repositioning";
    // Movement / dance never damages unless the text is also hostile (already excluded)
    damage = 0;
    highlight = body.phase === "forge" ? "FORGE" : action === "dodge" ? "DODGE" : "MOVE";
  } else if (action === "heal") {
    heal = clamp(Math.round(uniqueness / 18) + speedBonus, 1, 8);
    damage = 0;
    highlight = body.phase === "forge" ? "FORGE" : "HEAL";
  } else if (action === "buff") {
    effectMs = clamp(Math.round(2000 + uniqueness * 40), 1500, 7000);
    effectLabel = body.prompt.trim().slice(0, 40) || "presence";
    damage = 0;
    highlight = body.phase === "forge" ? "FORGE" : "BUFF";
  } else if (action === "spawn") {
    effectMs = clamp(Math.round(2000 + uniqueness * 40), 1500, 7000);
    effectLabel = body.prompt.trim().slice(0, 40) || "equipped";
    // Spawn only damages if it's weapon-like / hostile; bubble shield style = 0
    damage = isHostilePrompt(body.prompt)
      ? uniqueness >= 40
        ? clamp(Math.round(uniqueness / 14) + speedBonus, MIN_DAMAGE, MAX_DAMAGE)
        : uniqueness >= 25
          ? 1
          : 0
      : 0;
    highlight = body.phase === "forge" ? "FORGE" : "SPAWN";
  } else if (action === "special") {
    // Special can damage only when hostile intent is clear
    damage = isHostilePrompt(body.prompt)
      ? clamp(Math.round(uniqueness / 14) + speedBonus, MIN_DAMAGE, MAX_DAMAGE)
      : 0;
    if (!isHostilePrompt(body.prompt)) {
      effectMs = clamp(Math.round(1500 + uniqueness * 20), 1000, 5000);
      effectLabel = "flourish";
    }
    highlight =
      body.phase === "forge"
        ? "FORGE"
        : damage === 0
          ? "FLOURISH"
          : uniqueness >= 75
            ? "CRITICAL"
            : "HIT";
  } else {
    // attack
    damage = clamp(
      Math.round(uniqueness / 14) + speedBonus - (uniqueness < 30 ? 1 : 0),
      MIN_DAMAGE,
      MAX_DAMAGE
    );
    if (tokens(body.prompt).length === 1 && uniqueness < 25) {
      damage = clamp(damage, 0, 2);
    }
    highlight =
      body.phase === "forge"
        ? "FORGE"
        : uniqueness >= 75
          ? "CRITICAL"
          : damage === 0
            ? "WHIFF"
            : "HIT";
  }

  damage = clamp(damage, MIN_DAMAGE, MAX_DAMAGE);

  const snippet = body.prompt.slice(0, 70);
  const forgePrefix =
    body.phase === "forge"
      ? `Char ${body.player} forges an agent and `
      : `Char ${body.player} `;

  let storyBeat = "";
  switch (action) {
    case "block":
      storyBeat = `${forgePrefix}raises a guard from "${snippet}" — uniqueness ${uniqueness}. Block ~${(blockMs / 1000).toFixed(1)}s. No damage.`;
      break;
    case "dodge":
      storyBeat = `${forgePrefix}slips aside with "${snippet}" — uniqueness ${uniqueness}. No damage.`;
      break;
    case "move":
      storyBeat = `${forgePrefix}${effectLabel === "dancing" ? "dances" : "moves"} with "${snippet}" — uniqueness ${uniqueness}. It's motion, not a hit — 0 damage.`;
      break;
    case "spawn":
      storyBeat = `${forgePrefix}manifests "${snippet}" — uniqueness ${uniqueness}${damage ? `, ${damage} damage` : ", no damage"}.`;
      break;
    case "buff":
      storyBeat = `${forgePrefix}sets a vibe with "${snippet}" — uniqueness ${uniqueness}. Presence only, 0 damage.`;
      break;
    case "heal":
      storyBeat = `${forgePrefix}mends with "${snippet}" — recovers ${heal} HP (uniqueness ${uniqueness}).`;
      break;
    default:
      storyBeat = `${forgePrefix}acts with "${snippet}" — uniqueness ${uniqueness}, ${damage} damage.`;
  }

  if (isLiquidPrompt(body.prompt) && action === "attack") {
    const goo = inferAnim(body.prompt, "attack", damage).projectile?.name || "goop";
    if (isCrotchSprayPrompt(body.prompt)) {
      storyBeat =
        damage > 0
          ? `${forgePrefix}grabs their hips, thrusts, and sprays a blast of ${goo} from below — it splatters the opponent for ${damage} damage.`
          : `${forgePrefix}grabs their hips, thrusts, and sprays a blast of ${goo} from below — it splatters everywhere for 0 damage.`;
    } else {
      storyBeat =
        damage > 0
          ? `${forgePrefix}unleashes a blast of ${goo} at the opponent — it splatters everywhere for ${damage} damage (uniqueness ${uniqueness}).`
          : `${forgePrefix}unleashes a blast of ${goo} that splatters all over the opponent — disgusting, hilarious, and somehow 0 damage.`;
    }
    highlight = damage > 0 ? "HIT" : "SPLAT";
  }

  // Concurrent: if the opponent is mid-move, decide dodge / interrupt
  const opp = body.player === 1 ? body.active2 : body.active1;
  const oppLive = !!(opp && opp.until > Date.now() - 500);
  const oppMotion =
    oppLive &&
    (opp!.action === "move" ||
      opp!.action === "dodge" ||
      opp!.style === "dance" ||
      opp!.style === "run" ||
      opp!.style === "fly" ||
      opp!.style === "jump" ||
      /dance|run|fly|jump|twirl|spin/i.test(opp!.prompt));
  const oppBlocking =
    oppLive && (opp!.action === "block" || opp!.style === "block");

  let clash: ClashResolveResponse["clash"] = "none";
  let opponentAnim: ClashResolveResponse["opponentAnim"];
  let interruptOpponent = false;

  if (damage > 0 && oppBlocking) {
    clash = "block";
    damage = 0;
    opponentAnim = { style: "block", intensity: 0.7, hits: false };
    highlight = "BLOCKED";
    storyBeat = `${forgePrefix}strikes while the opponent guards — the hit is eaten. 0 damage.`;
  } else if (damage > 0 && oppMotion) {
    // Motion makes dodging plausible — generics miss more often
    const dodgeChance = uniqueness < 30 ? 0.72 : uniqueness < 55 ? 0.48 : 0.28;
    if (Math.random() < dodgeChance) {
      clash = "dodge";
      damage = 0;
      opponentAnim = { style: "dodge", intensity: 0.8, hits: false, radius: 1.9 };
      highlight = "DODGE";
      storyBeat = `${forgePrefix}goes for "${snippet}" while the opponent is mid-${opp!.style || "move"} — they slip aside. 0 damage.`;
    } else {
      clash = "interrupt";
      interruptOpponent = true;
      storyBeat = `${forgePrefix}catches them mid-${opp!.style || "motion"} with "${snippet}" — uniqueness ${uniqueness}, ${damage} damage.`;
    }
  }

  const anim = inferAnim(body.prompt, action, damage);

  const res: ClashResolveResponse = {
    action,
    damage,
    uniqueness,
    speedBonus,
    blockMs: blockMs || undefined,
    blockPower: blockPower || undefined,
    effectMs: effectMs || undefined,
    effectLabel: effectLabel || undefined,
    heal: heal || undefined,
    anim,
    opponentAnim,
    clash,
    interruptOpponent: interruptOpponent || undefined,
    storyBeat,
    highlight,
  };

  if (body.phase === "forge") {
    const word = body.prompt.trim().split(/\s+/).slice(0, 3).join(" ") || "Nameless";
    res.agentUpdate = {
      name: word.slice(0, 28),
      epithet:
        action === "move"
          ? "enters dancing"
          : uniqueness > 55
            ? "oddly specific omen"
            : "rushed into the ring",
      aura: uniqueness > 55 ? "fracture shimmer" : "dim charge",
      forged: true,
    };
  }

  return res;
}
