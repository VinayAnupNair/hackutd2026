"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type {
  AnimBeat,
  AnimProjectile,
  AnimProp,
  AnimSpec,
  AnimStyle,
  AnimSummon,
  HitReaction,
  PlayerId,
} from "@/lib/clash";

type Props = {
  forged1: boolean;
  forged2: boolean;
  actor: PlayerId | null;
  anim: AnimSpec | null;
  hitKey: number;
  damage: number;
  /** Concurrent secondary play (e.g. defender dodges while attacker swings) */
  oppActor?: PlayerId | null;
  oppAnim?: AnimSpec | null;
  oppHitKey?: number;
  oppDamage?: number;
  blocking1: boolean;
  blocking2: boolean;
};

// ——— World constants ———
const G = 20;
const STAND = 1.0;
const LIE_H = 0.32;
const FLOOR_R = 3.35;
const RING_R = 2.65;

// ——— Pose ———
type Pose = {
  aLx: number;
  aLz: number;
  aRx: number;
  aRz: number;
  lLx: number;
  lRx: number;
  lLz: number;
  lRz: number;
  pitch: number;
  roll: number;
  twist: number;
  crouch: number;
  propX: number;
  propZ: number;
  headX: number;
};

const NEUTRAL: Pose = {
  aLx: 0,
  aLz: 0,
  aRx: 0,
  aRz: 0,
  lLx: 0,
  lRx: 0,
  lLz: 0,
  lRz: 0,
  pitch: 0,
  roll: 0,
  twist: 0,
  crouch: 0,
  propX: 0,
  propZ: 0,
  headX: 0,
};
const POSE_KEYS = Object.keys(NEUTRAL) as (keyof Pose)[];

const GUARD: Pose = {
  ...NEUTRAL,
  aLx: -1.25,
  aLz: 0.3,
  aRx: -0.95,
  aRz: -0.3,
  lLx: -0.22,
  lRx: 0.22,
  pitch: 0.08,
  crouch: 0.06,
};

const BLOCK_POSE: Pose = {
  ...GUARD,
  aLx: -1.75,
  aLz: 0.75,
  aRx: -1.65,
  aRz: -0.75,
  crouch: 0.15,
  pitch: 0.12,
  headX: 0.25,
};

const FLAIL: Pose = {
  ...NEUTRAL,
  aLx: -2.2,
  aLz: -1.1,
  aRx: -2.0,
  aRz: 1.2,
  lLx: -0.7,
  lRx: 0.4,
  lLz: -0.25,
  lRz: 0.25,
  headX: -0.4,
};

const SPRAWL: Pose = {
  ...NEUTRAL,
  aLx: -0.3,
  aLz: -1.3,
  aRx: -0.2,
  aRz: 1.4,
  lLz: -0.3,
  lRz: 0.25,
  headX: -0.2,
};

type Phys = {
  state: "air" | "fall" | "down" | "getup" | "slide" | "respawn";
  vel: THREE.Vector3;
  pitchVel: number;
  timer: number;
  bounces: number;
  reaction: HitReaction;
  lieTarget: number;
};

type Fighter = {
  id: PlayerId;
  root: THREE.Group;
  rig: THREE.Group;
  head: THREE.Mesh;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  shield: THREE.Mesh;
  propHold: THREE.Group;
  teamMats: THREE.MeshStandardMaterial[];
  allMats: THREE.MeshStandardMaterial[];
  baseEmissive: THREE.Color;
  home: THREE.Vector3;
  P: THREE.Vector3;
  yaw: number;
  pose: Pose;
  ctrl: "idle" | "anim" | "phys";
  phys: Phys;
  recoil: number;
  recoilVel: number;
  spin: number;
  flash: number;
  squash: number;
  gait: number;
  walkAmp: number;
  shieldFlash: number;
  blocking: boolean;
  prevARx: number;
  getupFrom: number;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = THREE.MathUtils.lerp;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeIn = (x: number) => x * x * x;
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const easeSine = (x: number) => -(Math.cos(Math.PI * clamp01(x)) - 1) / 2;
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

function lerpAngle(a: number, b: number, k: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function wrapPi(a: number) {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function lerpPose(out: Pose, target: Pose, k: number, skip?: (keyof Pose)[]) {
  for (const key of POSE_KEYS) {
    if (skip?.includes(key)) continue;
    out[key] = lerp(out[key], target[key], k);
  }
}

function parseColor(hex: string | undefined, fallback = 0xffe566) {
  try {
    return hex ? new THREE.Color(hex).getHex() : fallback;
  } catch {
    return fallback;
  }
}

function makeFighter(id: PlayerId, color: number, x: number): Fighter {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  rig.rotation.order = "YXZ";
  rig.position.y = STAND;
  root.add(rig);

  const team = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.2,
    roughness: 0.5,
    emissive: color,
    emissiveIntensity: 0.1,
    transparent: true,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x3d3830,
    metalness: 0.1,
    roughness: 0.8,
    transparent: true,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    metalness: 0.6,
    roughness: 0.2,
    transparent: true,
  });

  const torsoMat = team.clone();
  const headMat = team.clone();
  const armMatL = team.clone();
  const armMatR = team.clone();

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.55, 4, 12), torsoMat);
  body.position.y = 0.08;
  rig.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 16), headMat);
  head.position.y = 0.8;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.08), visorMat);
  visor.position.set(0, 0.04, 0.21);
  head.add(visor);
  rig.add(head);

  const makeArm = (side: -1 | 1, mat: THREE.MeshStandardMaterial) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.44, 0.42, 0);
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.4, 3, 8), mat);
    limb.position.y = -0.3;
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), mat);
    fist.position.y = -0.6;
    pivot.add(limb, fist);
    rig.add(pivot);
    return pivot;
  };
  const armL = makeArm(-1, armMatL);
  const armR = makeArm(1, armMatR);

  const makeLeg = (side: -1 | 1) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.17, -0.3, 0);
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.4, 3, 8), dark);
    limb.position.y = -0.33;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.3), dark);
    foot.position.set(0, -0.66, 0.06);
    pivot.add(limb, foot);
    rig.add(pivot);
    return pivot;
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  const propHold = new THREE.Group();
  propHold.position.y = -0.62;
  armR.add(propHold);

  const shield = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.05, 8, 40),
    new THREE.MeshStandardMaterial({
      color: 0x7ec8ff,
      emissive: 0x3a9fff,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0,
      metalness: 0.4,
      roughness: 0.2,
    })
  );
  shield.position.set(0, 1.15, 0.55);
  root.add(shield);

  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o !== shield) o.castShadow = true;
  });

  const home = new THREE.Vector3(x, 0, 0);
  return {
    id,
    root,
    rig,
    head,
    armL,
    armR,
    legL,
    legR,
    shield,
    propHold,
    teamMats: [torsoMat, headMat, armMatL, armMatR],
    allMats: [torsoMat, headMat, armMatL, armMatR, dark, visorMat],
    baseEmissive: new THREE.Color(color),
    home,
    P: new THREE.Vector3(x, STAND, 0),
    yaw: x < 0 ? Math.PI / 2 : -Math.PI / 2,
    pose: { ...GUARD },
    ctrl: "idle",
    phys: {
      state: "slide",
      vel: new THREE.Vector3(),
      pitchVel: 0,
      timer: 0,
      bounces: 0,
      reaction: "none",
      lieTarget: 0,
    },
    recoil: 0,
    recoilVel: 0,
    spin: 0,
    flash: 0,
    squash: 0,
    gait: 0,
    walkAmp: 0,
    shieldFlash: 0,
    blocking: false,
    prevARx: GUARD.aRx,
    getupFrom: 0,
  };
}

function applyPose(f: Fighter) {
  const p = f.pose;
  f.root.position.set(f.P.x, f.P.y - STAND, f.P.z);
  f.root.rotation.y = f.yaw;
  f.rig.rotation.set(p.pitch + f.recoil, p.twist, p.roll);
  const s = f.squash;
  f.rig.scale.set(1 + s * 0.4, 1 - s, 1 + s * 0.4);

  const walk = Math.sin(f.gait) * f.walkAmp;
  const split = p.crouch * 1.1;
  f.armL.rotation.set(p.aLx + walk * 0.35, 0, p.aLz);
  f.armR.rotation.set(p.aRx - walk * 0.35, 0, p.aRz);
  f.legL.rotation.set(p.lLx - split - walk * 0.65, 0, p.lLz);
  f.legR.rotation.set(p.lRx + split + walk * 0.65, 0, p.lRz);
  f.head.rotation.set(p.headX + f.recoil * 0.8, 0, 0);
  f.propHold.rotation.set(p.propX, 0, p.propZ);

  for (const m of f.teamMats) {
    m.emissive.copy(f.baseEmissive).lerp(WHITE, f.flash);
    m.emissiveIntensity = 0.1 + f.flash * 1.4;
  }
  const sm = f.shield.material as THREE.MeshStandardMaterial;
  sm.opacity = Math.min(1, (f.blocking ? 0.7 : 0) + f.shieldFlash);
  f.shield.scale.setScalar(1 + f.shieldFlash * 0.25);
}

const WHITE = new THREE.Color(0xffffff);

function buildProp(spec: AnimProp) {
  const g = new THREE.Group();
  const color = parseColor(spec.color, 0x1a1814);
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.25,
    roughness: 0.6,
  });
  const len = spec.length || 1.2;
  const joints: THREE.Group[] = [];

  if (["belt", "whip", "rope", "chain"].includes(spec.kind)) {
    const segs = 8;
    const segLen = len / segs;
    let parent: THREE.Object3D = g;
    for (let i = 0; i < segs; i++) {
      const joint = new THREE.Group();
      joint.position.y = i === 0 ? 0 : -segLen;
      const thickness = spec.kind === "whip" ? 0.06 * (1 - i / (segs * 1.4)) : 0.07;
      const seg = new THREE.Mesh(
        spec.kind === "chain"
          ? new THREE.TorusGeometry(segLen * 0.45, 0.025, 6, 12)
          : new THREE.BoxGeometry(
              spec.kind === "belt" ? 0.05 : thickness,
              segLen * 1.02,
              spec.kind === "belt" ? 0.15 : thickness
            ),
        mat
      );
      seg.position.y = -segLen / 2;
      if (spec.kind === "chain") seg.rotation.y = (i % 2) * (Math.PI / 2);
      joint.add(seg);
      parent.add(joint);
      parent = joint;
      joints.push(joint);
    }
    if (spec.kind === "belt") {
      const buckle = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.14, 0.2),
        new THREE.MeshStandardMaterial({ color: 0xc9a24f, metalness: 0.9, roughness: 0.2 })
      );
      buckle.position.y = -segLen;
      parent.add(buckle);
    }
  } else if (spec.kind === "bat" || spec.kind === "staff") {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.kind === "bat" ? 0.08 : 0.04, 0.035, len, 10),
      mat
    );
    shaft.position.y = -len / 2;
    g.add(shaft);
  } else if (spec.kind === "sword") {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, len, 0.015),
      new THREE.MeshStandardMaterial({ color: 0xd6dde6, metalness: 0.95, roughness: 0.15 })
    );
    blade.position.y = -len / 2 - 0.08;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.06), mat);
    g.add(blade, guard);
  } else {
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.09, len, 0.09), mat);
    shaft.position.y = -len / 2;
    g.add(shaft);
  }
  g.userData.joints = joints;
  return g;
}

function buildProjectile(spec: AnimProjectile) {
  const color = parseColor(spec.color);
  const glowy = !!spec.trail || /fire|laser|plasma|energy|orb|bolt/i.test(spec.name || "");
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: glowy ? 0.9 : 0.06,
    metalness: spec.shape === "blob" ? 0.1 : 0.2,
    roughness: spec.shape === "blob" ? 0.35 : 0.6,
  });
  const s = spec.scale || 0.7;
  const g = new THREE.Group();
  let radius = 0.2 * s;

  if (spec.shape === "blob" && /poop|poo|dung/i.test(spec.name || "")) {
    const tiers = [
      [0.17, 0],
      [0.13, 0.1],
      [0.085, 0.18],
    ] as const;
    for (const [r, y] of tiers) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r * s, 14, 10), mat);
      m.scale.y = 0.7;
      m.position.y = y * s;
      g.add(m);
    }
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05 * s, 0.1 * s, 8), mat);
    tip.position.y = 0.25 * s;
    g.add(tip);
    radius = 0.17 * s;
  } else if (
    spec.shape === "blob" &&
    /cum|jizz|semen|goop|milk|cream|spit|piss|vomit|liquid|soup|blood/i.test(spec.name || "")
  ) {
    // Stretchy wet blob + trailing droplets
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 14, 12), mat);
    core.scale.set(0.85, 1.15, 0.85);
    g.add(core);
    for (let i = 0; i < 4; i++) {
      const drop = new THREE.Mesh(
        new THREE.SphereGeometry((0.06 + Math.random() * 0.05) * s, 8, 8),
        mat
      );
      drop.position.set(
        (Math.random() - 0.5) * 0.18 * s,
        -0.18 * s - i * 0.08 * s,
        (Math.random() - 0.5) * 0.12 * s
      );
      drop.scale.y = 1.4;
      g.add(drop);
    }
    radius = 0.2 * s;
  } else if (spec.shape === "blob") {
    const geo = new THREE.IcosahedronGeometry(0.2 * s, 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      v.multiplyScalar(0.85 + Math.random() * 0.3);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, mat));
  } else {
    let geo: THREE.BufferGeometry;
    switch (spec.shape) {
      case "box":
      case "belt":
        geo = new THREE.BoxGeometry(0.42 * s, 0.2 * s, 0.2 * s);
        radius = 0.14 * s;
        break;
      case "torus":
        geo = new THREE.TorusGeometry(0.22 * s, 0.06 * s, 8, 24);
        break;
      case "cone":
        geo = new THREE.ConeGeometry(0.1 * s, 0.45 * s, 12);
        geo.rotateX(Math.PI / 2);
        radius = 0.1 * s;
        break;
      case "cylinder":
        geo = new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.7 * s, 8);
        geo.rotateX(Math.PI / 2);
        radius = 0.06 * s;
        break;
      default:
        geo = new THREE.SphereGeometry(0.2 * s, 16, 14);
    }
    g.add(new THREE.Mesh(geo, mat));
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return { obj: g, radius, color, glowy };
}

// ——— Choreography (keyframed attacker motion) ———
type KeyFrame = {
  t: number;
  ease: "in" | "out" | "inout";
  pose: Pose;
  fwd: number;
  side: number;
  up: number;
};

const K = (
  t: number,
  p: Partial<Pose> & { fwd?: number; side?: number; up?: number } = {},
  ease: KeyFrame["ease"] = "inout"
): KeyFrame => {
  const { fwd = 0, side = 0, up = 0, ...rest } = p;
  return { t, ease, pose: { ...GUARD, ...rest }, fwd, side, up };
};

type Choreo = {
  dur: number;
  keys: KeyFrame[];
  hitAt?: number;
  releaseAt?: number;
  /** When set, `fwd` is a fraction of the distance to contact range */
  contact?: number;
};

const MELEE: AnimStyle[] = ["punch", "kick", "whip", "slash", "shove", "slam"];
const RANGED: AnimStyle[] = ["throw", "shoot", "cast", "spawn", "spray"];
const PROCEDURAL: AnimStyle[] = ["run", "fly", "dance", "heal", "buff", "taunt", "flourish"];

function choreoFor(style: AnimStyle, spec: AnimSpec): Choreo | null {
  const speed = 1.1 - (spec.intensity ?? 0.5) * 0.2;
  const propLen = spec.prop?.length ?? 1.2;
  switch (style) {
    case "punch":
      return {
        dur: 0.8 * speed,
        contact: 0.95,
        hitAt: 0.42,
        keys: [
          K(0),
          K(0.28, { aRx: -0.5, aRz: 0.35, twist: 0.45, pitch: 0.02, fwd: 0.3, lLx: -0.35, lRx: 0.3 }, "out"),
          K(0.42, { aRx: -1.62, aRz: -0.05, aLx: -0.9, twist: -0.45, pitch: 0.22, fwd: 1, lLx: -0.55, lRx: 0.45 }, "in"),
          K(0.58, { aRx: -1.45, aRz: -0.05, aLx: -1.0, twist: -0.35, pitch: 0.18, fwd: 0.95, lLx: -0.55, lRx: 0.45 }),
          K(1),
        ],
      };
    case "kick":
      return {
        dur: 0.95 * speed,
        contact: 1.15,
        hitAt: 0.42,
        keys: [
          K(0),
          K(0.25, { lRx: -1.25, lLx: 0.1, pitch: -0.12, aRx: -0.6, aRz: -0.5, fwd: 0.35, crouch: 0.03 }, "out"),
          K(0.42, { lRx: -1.8, lLx: 0.15, pitch: -0.42, twist: -0.25, aRx: 0.3, aRz: 0.6, aLx: -1.4, fwd: 1 }, "in"),
          K(0.6, { lRx: -1.4, lLx: 0.1, pitch: -0.3, twist: -0.15, aRx: 0.1, aRz: 0.4, fwd: 0.95 }),
          K(1),
        ],
      };
    case "whip":
    case "slash":
      return {
        dur: 1.05 * speed,
        contact: spec.prop ? 0.45 + propLen * 0.85 : 0.95,
        hitAt: 0.47,
        keys: [
          K(0),
          K(0.32, { aRx: -2.75, aRz: 0.25, propX: -1.3, twist: 0.55, pitch: -0.15, fwd: 0.3, lLx: -0.3 }, "out"),
          K(0.47, { aRx: -1.0, aRz: -0.25, propX: 0.25, twist: -0.45, pitch: 0.25, fwd: 1, lLx: -0.55, lRx: 0.4 }, "in"),
          K(0.62, { aRx: -0.2, aRz: -0.7, propX: 0.9, twist: -0.7, pitch: 0.3, fwd: 1, lLx: -0.55, lRx: 0.4 }),
          K(1),
        ],
      };
    case "shove":
      return {
        dur: 0.9 * speed,
        contact: 0.75,
        hitAt: 0.45,
        keys: [
          K(0),
          K(0.3, { aLx: -0.8, aRx: -0.8, aLz: 0.2, aRz: -0.2, crouch: 0.2, pitch: 0.12, fwd: 0.45 }, "out"),
          K(0.45, { aLx: -1.6, aRx: -1.6, aLz: 0.05, aRz: -0.05, crouch: 0.05, pitch: 0.35, fwd: 1, lLx: -0.6, lRx: 0.55 }, "in"),
          K(0.62, { aLx: -1.55, aRx: -1.55, pitch: 0.3, fwd: 1, lLx: -0.6, lRx: 0.55 }),
          K(1),
        ],
      };
    case "slam":
      return {
        dur: 1.25 * speed,
        contact: 0.85,
        hitAt: 0.58,
        keys: [
          K(0),
          K(0.2, { crouch: 0.35, aLx: 0.5, aRx: 0.5, pitch: 0.2, fwd: 0.1 }, "out"),
          K(0.45, { up: 1.5, fwd: 0.65, aLx: -3.0, aRx: -3.0, pitch: -0.15, lLx: -0.6, lRx: -0.6 }, "out"),
          K(0.58, { up: 0, fwd: 1, aLx: -0.9, aRx: -0.9, pitch: 0.55, crouch: 0.3 }, "in"),
          K(0.78, { crouch: 0.3, pitch: 0.4, fwd: 1, aLx: -0.7, aRx: -0.7 }),
          K(1),
        ],
      };
    case "throw":
      return {
        dur: 1.0 * speed,
        releaseAt: 0.44,
        keys: [
          K(0),
          K(0.32, { aRx: -2.8, aRz: 0.35, twist: 0.6, pitch: -0.18, lLx: -0.45, lRx: 0.35, aLx: -1.3, fwd: 0.05 }, "out"),
          K(0.46, { aRx: -1.15, aRz: -0.1, twist: -0.5, pitch: 0.3, lLx: -0.6, lRx: 0.5, aLx: -0.2, fwd: 0.25 }, "in"),
          K(0.66, { aRx: 0.25, aRz: -0.4, twist: -0.6, pitch: 0.35, lLx: -0.6, lRx: 0.5, aLx: 0, fwd: 0.3 }),
          K(1),
        ],
      };
    case "spray":
      // Lewd hip thrust: hands frame the pelvis, liquid bursts from the bottom
      return {
        dur: 1.35 * speed,
        releaseAt: 0.42,
        keys: [
          K(0),
          // Windup: crouch, hands drop to hips/crotch, lean back
          K(
            0.28,
            {
              crouch: 0.42,
              pitch: -0.35,
              aLx: 0.55,
              aRx: 0.55,
              aLz: -0.85,
              aRz: 0.85,
              lLx: -0.35,
              lRx: 0.2,
              headX: 0.2,
              fwd: 0.05,
            },
            "out"
          ),
          // Thrust: hips drive forward, hands flash open at the sides
          K(
            0.42,
            {
              crouch: 0.08,
              pitch: 0.55,
              aLx: -0.35,
              aRx: -0.35,
              aLz: -1.15,
              aRz: 1.15,
              lLx: -0.7,
              lRx: 0.55,
              headX: -0.15,
              fwd: 0.55,
            },
            "in"
          ),
          // Follow-through: keep spraying pose, slight bounce
          K(
            0.62,
            {
              crouch: 0.18,
              pitch: 0.35,
              aLx: 0.15,
              aRx: 0.15,
              aLz: -0.95,
              aRz: 0.95,
              lLx: -0.45,
              lRx: 0.35,
              fwd: 0.4,
            }
          ),
          K(
            0.82,
            {
              crouch: 0.12,
              pitch: 0.15,
              aLx: -0.2,
              aRx: -0.2,
              aLz: -0.55,
              aRz: 0.55,
              fwd: 0.2,
            }
          ),
          K(1),
        ],
      };
    case "shoot":
      return {
        dur: 0.85,
        releaseAt: 0.36,
        keys: [
          K(0),
          K(0.3, { aRx: -1.57, aRz: 0, aLx: -1.45, aLz: 0.45, twist: -0.15 }, "out"),
          K(0.36, { aRx: -1.57, aRz: 0, aLx: -1.45, aLz: 0.45, twist: -0.15 }),
          K(0.46, { aRx: -2.0, aLx: -1.75, aLz: 0.45, pitch: -0.15, fwd: -0.12, twist: -0.15 }, "out"),
          K(0.7, { aRx: -1.57, aLx: -1.45, aLz: 0.45, twist: -0.1 }),
          K(1),
        ],
      };
    case "cast":
    case "spawn": {
      const overhead = style === "spawn";
      return {
        dur: 1.0,
        releaseAt: 0.48,
        keys: [
          K(0),
          K(
            0.35,
            overhead
              ? { aLx: -2.9, aRx: -2.9, aLz: -0.3, aRz: 0.3, pitch: -0.15, up: 0.05 }
              : { aLx: -0.6, aRx: -0.6, aLz: -0.9, aRz: 0.9, crouch: 0.15, pitch: -0.1 },
            "out"
          ),
          K(0.5, { aLx: -1.6, aRx: -1.6, aLz: 0.25, aRz: -0.25, pitch: 0.25, fwd: 0.15 }, "in"),
          K(0.72, { aLx: -1.5, aRx: -1.5, aLz: 0.2, aRz: -0.2, pitch: 0.2, fwd: 0.15 }),
          K(1),
        ],
      };
    }
    case "block":
      return {
        dur: 0.7,
        keys: [K(0), K(0.35, { ...BLOCK_POSE }, "out"), K(1, { ...BLOCK_POSE })],
      };
    case "dodge":
      return {
        dur: 0.85,
        keys: [
          K(0),
          K(0.3, { side: 1.2, fwd: -0.2, crouch: 0.35, roll: -0.35, pitch: 0.15, lLz: -0.4, lRz: 0.3 }, "out"),
          K(0.65, { side: 1.25, fwd: -0.2, crouch: 0.25, roll: -0.15 }),
          K(1, { side: 1.2, fwd: -0.2 }),
        ],
      };
    case "jump":
      return {
        dur: 1.1,
        keys: [
          K(0),
          K(0.2, { crouch: 0.35, aLx: 0.7, aRx: 0.7, pitch: 0.25 }, "out"),
          K(0.5, { aLx: -2.8, aRx: -2.8, aLz: -0.4, aRz: 0.4, lLx: -1.1, lRx: -0.9, pitch: -0.1, fwd: 0.15 }),
          K(0.8, { crouch: 0.32, aLx: -0.6, aRx: -0.6, pitch: 0.2, fwd: 0.3 }),
          K(1, { fwd: 0.3 }),
        ],
      };
    default:
      return null;
  }
}

type Act = {
  f: Fighter;
  def: Fighter;
  spec: AnimSpec;
  style: AnimStyle;
  dmg: number;
  t: number;
  dur: number;
  choreo: Choreo | null;
  fired: boolean;
  firedBeats: Set<number>;
  summoned: boolean;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  sideV: THREE.Vector3;
  reach: number;
  startPose: Pose;
  startYOff: number;
  startAngle: number;
  startR: number;
  sgn: 1 | -1;
  prev: THREE.Vector3;
  held: ReturnType<typeof buildProjectile> | null;
};

type SummonEnt = {
  root: THREE.Group;
  spec: AnimSummon;
  owner: Fighter;
  def: Fighter;
  phase: "appear" | "run" | "attack" | "fade";
  t: number;
  hit: boolean;
  dmg: number;
  anim: AnimSpec;
};

type Proj = {
  obj: THREE.Object3D;
  radius: number;
  color: number;
  glowy: boolean;
  spec: AnimProjectile;
  vel: THREE.Vector3;
  g: number;
  t: number;
  T: number;
  hits: boolean;
  /** Liquid comedy — aims at target and splats even at 0 damage */
  splatShot: boolean;
  blocked: boolean;
  live: boolean;
  resting: number;
  def: Fighter;
  dir: THREE.Vector3;
  anim: AnimSpec;
  dmg: number;
  spinV: THREE.Vector3;
};

type Decal = {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  grow: number;
};

export function ArenaScene({
  forged1,
  forged2,
  actor,
  anim,
  hitKey,
  damage,
  oppActor = null,
  oppAnim = null,
  oppHitKey = 0,
  oppDamage = 0,
  blocking1,
  blocking2,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    setForged: (a: boolean, b: boolean) => void;
    setBlocking: (a: boolean, b: boolean) => void;
    play: (who: PlayerId, spec: AnimSpec, dmg: number) => void;
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const w = mount.clientWidth || 640;
    const h = mount.clientHeight || 360;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xcfc6b4, 0.03);

    const camera = new THREE.PerspectiveCamera(44, w / h, 0.1, 400);
    const camBase = new THREE.Vector3(0, 4.2, 8.2);
    const camLook = new THREE.Vector3(0, 1.2, 0);
    camera.position.copy(camBase);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6e675c, 1.1));
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.4);
    sun.position.set(3, 9, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -5;
    sun.shadow.camera.right = 5;
    sun.shadow.camera.top = 5;
    sun.shadow.camera.bottom = -5;
    scene.add(sun);
    const p1 = new THREE.PointLight(0x14c4ae, 0.5, 14);
    p1.position.set(-3.5, 3, 1);
    const p2 = new THREE.PointLight(0xff6f45, 0.5, 14);
    p2.position.set(3.5, 3, 1);
    scene.add(p1, p2);

    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(FLOOR_R, FLOOR_R, 0.3, 64),
      new THREE.MeshStandardMaterial({ color: 0xe8e2d6, metalness: 0.05, roughness: 0.85 })
    );
    floor.position.y = -0.15;
    floor.receiveShadow = true;
    scene.add(floor);

    const ringEdge = new THREE.Mesh(
      new THREE.TorusGeometry(3.2, 0.08, 8, 64),
      new THREE.MeshStandardMaterial({
        color: 0xb8924a,
        metalness: 0.7,
        roughness: 0.3,
        emissive: 0xb8924a,
        emissiveIntensity: 0.25,
      })
    );
    ringEdge.rotation.x = Math.PI / 2;
    ringEdge.position.y = 0.03;
    scene.add(ringEdge);

    const f1 = makeFighter(1, 0x0d9b8a, -1.7);
    const f2 = makeFighter(2, 0xe85d3a, 1.7);
    scene.add(f1.root, f2.root);
    const fighters = [f1, f2];
    const other = (f: Fighter) => (f === f1 ? f2 : f1);

    // ——— Particles (gravity, floor contact) ———
    const PN = 320;
    const pPos = new Float32Array(PN * 3).fill(-999);
    const pCol = new Float32Array(PN * 3);
    const pVel = new Float32Array(PN * 3);
    const pLife = new Float32Array(PN);
    const pGrav = new Float32Array(PN);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
    const particles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        size: 0.08,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
      })
    );
    particles.frustumCulled = false;
    scene.add(particles);
    let pCursor = 0;
    const tmpColor = new THREE.Color();

    const emit = (
      at: THREE.Vector3,
      n: number,
      color: number,
      opts: {
        speed?: number;
        up?: number;
        gravity?: number;
        life?: number;
        dir?: THREE.Vector3;
        push?: number;
      } = {}
    ) => {
      const { speed = 3, up = 1.5, gravity = G * 0.6, life = 0.8, dir, push = 0 } = opts;
      tmpColor.setHex(color);
      for (let k = 0; k < n; k++) {
        const i = pCursor;
        pCursor = (pCursor + 1) % PN;
        const v = new THREE.Vector3(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5
        )
          .normalize()
          .multiplyScalar(speed * (0.3 + Math.random() * 0.7));
        if (dir) v.addScaledVector(dir, push * (0.5 + Math.random() * 0.5));
        v.y += up * Math.random();
        pPos[i * 3] = at.x;
        pPos[i * 3 + 1] = at.y;
        pPos[i * 3 + 2] = at.z;
        pVel[i * 3] = v.x;
        pVel[i * 3 + 1] = v.y;
        pVel[i * 3 + 2] = v.z;
        const shade = 0.8 + Math.random() * 0.4;
        pCol[i * 3] = tmpColor.r * shade;
        pCol[i * 3 + 1] = tmpColor.g * shade;
        pCol[i * 3 + 2] = tmpColor.b * shade;
        pLife[i] = life * (0.6 + Math.random() * 0.6);
        pGrav[i] = gravity;
      }
    };

    const dust = (x: number, z: number, amount: number) =>
      emit(new THREE.Vector3(x, 0.05, z), Math.round(8 + amount * 18), 0xb8ad98, {
        speed: 1.4 + amount * 1.5,
        up: 0.8 + amount,
        gravity: 3,
        life: 0.9,
      });

    // ——— Decals (splats) ———
    const decals: Decal[] = [];
    const addDecal = (mesh: THREE.Mesh, parent: THREE.Object3D, life: number) => {
      parent.add(mesh);
      mesh.scale.multiplyScalar(0.01);
      decals.push({ mesh, life, max: life, grow: 0 });
    };
    const splatOnFighter = (f: Fighter, color: number, scale: number) => {
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry((0.11 + Math.random() * 0.08) * scale, 10, 8),
          new THREE.MeshStandardMaterial({
            color,
            roughness: 0.35,
            metalness: 0.1,
            transparent: true,
          })
        );
        m.position.set((Math.random() - 0.5) * 0.35, 0.1 + Math.random() * 0.55, 0.3);
        m.userData.targetScale = new THREE.Vector3(1, 1, 0.35);
        addDecal(m, f.rig, 5);
      }
    };
    const splatOnFloor = (x: number, z: number, color: number, scale: number) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.32 * scale, 14, 8),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4, transparent: true })
      );
      m.position.set(x, 0.005, z);
      m.userData.targetScale = new THREE.Vector3(1 + Math.random() * 0.4, 0.04, 1);
      m.rotation.y = Math.random() * Math.PI;
      addDecal(m, scene, 7);
    };

    // ——— Feel: hit-stop + camera shake ———
    let hitStop = 0;
    let shake = 0;

    // ——— Props ———
    const clearProp = (f: Fighter) => {
      while (f.propHold.children.length) {
        const c = f.propHold.children[0];
        f.propHold.remove(c);
        c.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
          }
        });
      }
    };
    const equipProp = (f: Fighter, prop: AnimProp | null | undefined) => {
      clearProp(f);
      if (prop) f.propHold.add(buildProp(prop));
    };

    // ——— Concurrent acts (both fighters can animate at once) ———
    const acts: { 1: Act | null; 2: Act | null } = { 1: null, 2: null };

    const endAct = (a: Act) => {
      if (a.held) {
        a.held.obj.parent?.remove(a.held.obj);
        a.held = null;
      }
      clearProp(a.f);
      if (a.f.ctrl === "anim") a.f.ctrl = "idle";
      if (acts[a.f.id] === a) acts[a.f.id] = null;
    };


    // ——— Defender reactions ———
    const enterPhys = (f: Fighter, state: Phys["state"], reaction: HitReaction) => {
      if (acts[f.id]) endAct(acts[f.id]!);
      f.ctrl = "phys";
      f.phys.state = state;
      f.phys.reaction = reaction;
      f.phys.bounces = 0;
      f.phys.timer = 0;
      f.phys.pitchVel = 0;
    };

    const react = (
      def: Fighter,
      dir: THREE.Vector3,
      reaction: HitReaction,
      force: number,
      dmg: number
    ) => {
      const F = clamp01(force);
      def.flash = 1;
      def.recoilVel -= 4 + 8 * F;
      const v = def.phys.vel;
      switch (reaction) {
        case "launch":
          enterPhys(def, "air", "launch");
          v.copy(dir).multiplyScalar(4 + 5 * F);
          v.y = 8 + 5 * F;
          v.z += (Math.random() - 0.5) * 2;
          def.phys.pitchVel = -(7 + 7 * F);
          break;
        case "knockback":
          enterPhys(def, "air", "knockback");
          v.copy(dir).multiplyScalar(3 + 3 * F);
          v.y = 2.5 + 2 * F;
          def.phys.pitchVel = -(1.5 + 2.5 * F);
          break;
        case "knockdown":
          enterPhys(def, "fall", "knockdown");
          v.copy(dir).multiplyScalar(1.5 + 1.5 * F);
          v.y = 0;
          def.phys.pitchVel = -(1.5 + F);
          break;
        case "spin":
          enterPhys(def, "slide", "spin");
          v.copy(dir).multiplyScalar(1.5 + F);
          def.spin = (12 + 10 * F) * (Math.random() < 0.5 ? -1 : 1);
          break;
        case "stagger":
          enterPhys(def, "slide", "stagger");
          v.copy(dir).multiplyScalar(2 + 2 * F);
          def.recoilVel -= 4;
          break;
        default:
          if (dmg > 0) {
            enterPhys(def, "slide", "flinch");
            v.copy(dir).multiplyScalar(0.6 + 1.2 * F);
          }
      }
    };

    const strike = (
      spec: AnimSpec,
      dmg: number,
      def: Fighter,
      dir: THREE.Vector3,
      at: THREE.Vector3,
      color = 0xffe566
    ) => {
      const hits = dmg > 0 && spec.hits !== false;
      if (def.blocking) {
        def.shieldFlash = 1;
        def.recoilVel -= 2;
        enterPhys(def, "slide", "flinch");
        def.phys.vel.copy(dir).multiplyScalar(0.9);
        emit(at, 22, 0x7ec8ff, { speed: 4, up: 1, life: 0.5 });
        hitStop = 0.06;
        shake = Math.max(shake, 0.06);
        return;
      }
      if (!hits) {
        def.recoilVel -= 2.5;
        emit(at, 6, 0xd8d0c0, { speed: 1.2, up: 0.4, life: 0.4, gravity: 2 });
        return;
      }
      const reaction =
        spec.reaction && spec.reaction !== "none"
          ? spec.reaction
          : dmg >= 7
            ? "knockback"
            : dmg >= 4
              ? "stagger"
              : "flinch";
      const force = spec.force ?? clamp01(0.3 + dmg / 12);
      hitStop = 0.05 + dmg * 0.012;
      shake = Math.max(shake, 0.05 + dmg * 0.022 + (reaction === "launch" ? 0.1 : 0));
      emit(at, 14 + dmg * 4, color, { speed: 2.5 + dmg * 0.4, up: 1.2, life: 0.55, dir, push: 2 });
      emit(at, 6, 0xffffff, { speed: 4, up: 0.5, life: 0.25, gravity: 0 });
      react(def, dir, reaction, force, dmg);
    };

    // ——— Projectiles ———
    const projectiles: Proj[] = [];
    const fireProjectile = (a: Act) => {
      const spec = a.spec.projectile;
      const built = a.held ?? (spec ? buildProjectile(spec) : null);
      const pspec: AnimProjectile =
        spec ?? { shape: "sphere", color: "#ffd166", scale: 0.6, trail: true, name: "energy" };
      const b = built ?? buildProjectile(pspec);
      a.held = null;

      const start = new THREE.Vector3();
      const air = a.spec.airAction;
      const sprayLike =
        a.style === "spray" || air === "spray" || air === "throw" || (air === "cast" && !!pspec.splat);
      if (sprayLike || a.style === "spray") {
        // Burst from the pelvis / bottom — not the hands (works mid-air too)
        start.copy(a.f.P);
        start.y = a.f.P.y - 0.55 - a.f.pose.crouch * 0.15;
        start.addScaledVector(a.dir, 0.32);
      } else if (a.style === "cast" && a.spec.limb === "head") {
        start.copy(a.f.P);
        start.y = a.f.P.y + 0.7;
        start.addScaledVector(a.dir, 0.2);
      } else {
        a.f.propHold.getWorldPosition(start);
      }
      if (b.obj.parent) b.obj.parent.remove(b.obj);
      b.obj.position.copy(start);
      scene.add(b.obj);

      const def = a.def;
      const hits = a.dmg > 0 && a.spec.hits !== false;
      const splatShot = !!pspec.splat;
      const target = new THREE.Vector3();
      if (def.blocking) {
        def.shield.getWorldPosition(target);
      } else if (hits || splatShot) {
        // Liquids always land on the victim — the mess is the joke, even at 0 HP
        target.copy(def.P).addScaledVector(a.dir, -0.15);
        target.y += splatShot ? 0.55 : 0.3;
      } else {
        target
          .copy(def.P)
          .addScaledVector(a.dir, 1.6)
          .addScaledVector(a.sideV, (Math.random() < 0.5 ? -1 : 1) * 1.1);
        target.y = 0.4;
      }

      const style = sprayLike ? "spray" : a.style;
      const speed =
        style === "shoot" ? 17 : style === "spray" ? 9.5 : style === "throw" ? 7.5 : splatShot ? 8.5 : 11;
      const g =
        style === "shoot"
          ? 1.5
          : style === "spray"
            ? G * 0.45
            : style === "throw" || splatShot
              ? G * (splatShot ? 0.85 : 1)
              : pspec.shape === "blob"
                ? G * 0.6
                : 0;
      const dist = start.distanceTo(target);
      const T = Math.max(0.18, Math.min(0.95, dist / speed));
      const vel = target.clone().sub(start).divideScalar(T);
      // Spray arcs a bit upward from the hips then drops
      if (style === "spray") vel.y += 1.2 + 0.5 * g * T;
      else vel.y += 0.5 * g * T;

      const launchOne = (
        mesh: ReturnType<typeof buildProjectile>,
        vel0: THREE.Vector3,
        scaleMul: number,
        delay = 0
      ) => {
        const obj = mesh.obj;
        if (obj.parent) obj.parent.remove(obj);
        obj.position.copy(start);
        obj.scale.multiplyScalar(scaleMul);
        scene.add(obj);
        projectiles.push({
          obj,
          radius: mesh.radius * scaleMul,
          color: mesh.color,
          glowy: mesh.glowy,
          spec: { ...pspec, scale: (pspec.scale || 0.8) * scaleMul },
          vel: vel0,
          g,
          t: -delay,
          T,
          hits,
          splatShot,
          blocked: def.blocking,
          live: true,
          resting: 0,
          def,
          dir: a.dir.clone(),
          anim: a.spec,
          dmg: a.dmg,
          spinV: pspec.spin
            ? new THREE.Vector3(8 + Math.random() * 6, 5 + Math.random() * 4, 0)
            : new THREE.Vector3(3, 5, 2),
        });
      };

      launchOne(b, vel, 1, 0);

      // Extra spurts for spray — looks like a burst from the hips, not one thrown ball
      if (style === "spray") {
        for (let i = 0; i < 3; i++) {
          const extra = buildProjectile({
            ...pspec,
            scale: (pspec.scale || 0.9) * (0.45 + Math.random() * 0.35),
          });
          const v2 = vel
            .clone()
            .add(
              new THREE.Vector3(
                (Math.random() - 0.5) * 2.2,
                0.6 + Math.random() * 1.4,
                (Math.random() - 0.5) * 2.2
              )
            );
          launchOne(extra, v2, 1, 0.04 * (i + 1));
        }
      }

      // Launch spray mist
      emit(start, style === "spray" ? 28 : splatShot ? 18 : 6, b.color, {
        speed: style === "spray" ? 4.5 : splatShot ? 2.8 : 1.5,
        up: style === "spray" ? 2.2 : splatShot ? 1.2 : 0.3,
        life: style === "spray" ? 0.7 : splatShot ? 0.55 : 0.25,
        gravity: splatShot || style === "spray" ? G * 0.55 : 0,
        dir: a.dir,
        push: style === "spray" ? 4 : splatShot ? 2 : 0,
      });
    };

    const removeProj = (p: Proj) => {
      scene.remove(p.obj);
      p.obj.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      projectiles.splice(projectiles.indexOf(p), 1);
    };

    const splatProj = (p: Proj, onFighter: Fighter | null) => {
      const pos = p.obj.position;
      const scale = p.spec.scale || 0.8;
      // Big wet burst + drip rain
      emit(pos, 40, p.color, {
        speed: 4.2,
        up: 3.2,
        gravity: G * 0.9,
        life: 1.2,
        dir: p.dir,
        push: 2.2,
      });
      emit(pos, 18, p.color, { speed: 1.4, up: 0.4, gravity: G * 1.1, life: 1.4 });
      if (onFighter) {
        splatOnFighter(onFighter, p.color, scale * 1.25);
        // Extra drips on chest / face
        splatOnFighter(onFighter, p.color, scale * 0.7);
        onFighter.recoilVel -= 1.5;
        onFighter.flash = Math.max(onFighter.flash, 0.35);
      }
      splatOnFloor(
        onFighter ? onFighter.P.x - p.dir.x * 0.25 : pos.x,
        onFighter ? onFighter.P.z + 0.15 : pos.z,
        p.color,
        scale * 1.35
      );
      // Second puddle for mess
      splatOnFloor(
        (onFighter ? onFighter.P.x : pos.x) + (Math.random() - 0.5) * 0.6,
        (onFighter ? onFighter.P.z : pos.z) + (Math.random() - 0.5) * 0.5,
        p.color,
        scale * 0.7
      );
      shake = Math.max(shake, 0.08);
      removeProj(p);
    };

    const updateProjectiles = (dt: number) => {
      for (const p of [...projectiles]) {
        p.t += dt;
        if (p.t < 0) {
          p.obj.visible = false;
          continue;
        }
        p.obj.visible = true;
        p.vel.y -= p.g * dt;
        p.obj.position.addScaledVector(p.vel, dt);
        if (p.spinV.lengthSq() > 0) {
          p.obj.rotation.x += p.spinV.x * dt;
          p.obj.rotation.y += p.spinV.y * dt;
        } else if (p.live && p.vel.lengthSq() > 1) {
          p.obj.lookAt(p.obj.position.clone().add(p.vel));
        }
        // Drip trail for liquids in flight
        if (p.live && (p.splatShot || p.glowy) && Math.random() < (p.splatShot ? 0.85 : 0.5)) {
          emit(p.obj.position, p.splatShot ? 3 : 2, p.color, {
            speed: p.splatShot ? 0.8 : 0.4,
            up: p.splatShot ? -0.2 : 0.6,
            gravity: p.splatShot ? G * 0.8 : -2,
            life: p.splatShot ? 0.55 : 0.3,
          });
        }

        if (p.live && p.t >= p.T && (p.hits || p.blocked || p.splatShot)) {
          p.live = false;
          const at = p.obj.position.clone();
          if (p.blocked) {
            if (p.hits) strike(p.anim, p.dmg, p.def, p.dir, at, p.color);
            else {
              p.def.shieldFlash = 1;
              emit(at, 16, 0x7ec8ff, { speed: 3, up: 1, life: 0.45 });
            }
            if (p.spec.splat) {
              splatProj(p, null);
              continue;
            }
            p.vel.set(-p.dir.x * 2.5, 3, (Math.random() - 0.5) * 2);
            p.g = G;
            continue;
          }
          // Damaging hit reactions only when HP actually moves
          if (p.hits) strike(p.anim, p.dmg, p.def, p.dir, at, p.color);
          if (p.spec.splat || p.splatShot) {
            splatProj(p, p.def);
            continue;
          }
          if (p.glowy) {
            emit(at, 30, p.color, { speed: 4, up: 1.5, life: 0.6, gravity: 2 });
            removeProj(p);
            continue;
          }
          p.vel.set(-p.dir.x * 1.5, 2.5, (Math.random() - 0.5) * 2);
          p.g = G;
          p.spinV.set(6, 4, 3);
        }

        const inRing = Math.hypot(p.obj.position.x, p.obj.position.z) < FLOOR_R;
        if (inRing && p.obj.position.y <= p.radius && p.vel.y < 0) {
          if (p.spec.splat) {
            splatProj(p, null);
            continue;
          }
          if (p.glowy) {
            emit(p.obj.position, 20, p.color, { speed: 3, up: 1.2, life: 0.5 });
            removeProj(p);
            continue;
          }
          p.live = false;
          p.g = G;
          p.obj.position.y = p.radius;
          if (Math.abs(p.vel.y) > 1.5) {
            dust(p.obj.position.x, p.obj.position.z, 0.2);
            p.vel.y = -p.vel.y * 0.35;
            p.vel.x *= 0.6;
            p.vel.z *= 0.6;
            p.spinV.multiplyScalar(0.5);
          } else {
            p.vel.set(p.vel.x * 0.9, 0, p.vel.z * 0.9);
            p.vel.multiplyScalar(Math.exp(-dt * 4));
            p.spinV.multiplyScalar(Math.exp(-dt * 6));
            p.resting += dt;
          }
        }
        if (p.resting > 1.8 || p.obj.position.y < -12 || p.t > 6) removeProj(p);
      }
    };

    // ——— Acting ———
    const faceYaw = (from: THREE.Vector3, to: THREE.Vector3) =>
      Math.atan2(to.x - from.x, to.z - from.z);

    const play = (who: PlayerId, spec: AnimSpec, dmg: number) => {
      // Only replace THIS fighter's move — the other keeps going
      if (acts[who]) endAct(acts[who]!);
      // Soft hits (dodge/whiff) shouldn't yank a fighter out of physics mid-air
      const f = who === 1 ? f1 : f2;
      if (f.ctrl === "phys" && dmg <= 0 && !spec.hits) return;

      const def = other(f);

      let style = spec.style;
      const hasProj = !!spec.projectile;
      if (hasProj && !RANGED.includes(style) && !MELEE.includes(style) && !PROCEDURAL.includes(style)) {
        style = "throw";
      }
      if (!MELEE.includes(style) && !RANGED.includes(style) && !PROCEDURAL.includes(style) &&
          !["block", "dodge", "jump"].includes(style)) {
        style = dmg > 0 ? "punch" : "taunt";
      }

      const prop =
        spec.prop ?? (style === "whip" ? { kind: "whip" as const, color: "#5c3a21", length: 1.5 } : null);
      equipProp(f, prop);

      if (Math.hypot(f.P.x, f.P.z) > FLOOR_R - 0.2 || f.P.y < 0) f.P.copy(f.home).setY(STAND);
      const origin = new THREE.Vector3(f.P.x, 0, f.P.z);
      const dir = new THREE.Vector3(def.P.x - f.P.x, 0, def.P.z - f.P.z);
      if (dir.lengthSq() < 0.01) dir.set(who === 1 ? 1 : -1, 0, 0);
      dir.normalize();
      const sideV = new THREE.Vector3(-dir.z, 0, dir.x);
      if (Math.random() < 0.5) sideV.negate();

      const multi = !!(spec.beats && spec.beats.length >= 2);
      const aerial = !multi && !!spec.airAction && (style === "fly" || style === "run" || style === "jump");
      const summonSpec =
        spec.summon || spec.beats?.find((b) => b.summon)?.summon || null;
      const bigSummon =
        !!summonSpec &&
        (summonSpec.kind === "sun" ||
          summonSpec.kind === "plane" ||
          summonSpec.kind === "car" ||
          summonSpec.kind === "truck" ||
          summonSpec.kind === "tank" ||
          summonSpec.scale >= 3);
      // Multi-beat & aerial combos use continuous procedural motion
      const choreo = multi || aerial ? null : choreoFor(style, { ...spec, prop });
      const dist = Math.hypot(def.P.x - f.P.x, def.P.z - f.P.z);
      const reach = choreo?.contact != null ? Math.max(0, dist - choreo.contact) : 1;

      f.ctrl = "anim";
      f.spin = 0;
      const laps = Math.max(0.5, Math.min(3, spec.laps || (style === "fly" ? 1 : 1.25)));
      const dur = choreo
        ? bigSummon
          ? Math.max(
              choreo.dur,
              summonSpec?.kind === "sun" ? 4.4 : summonSpec?.kind === "plane" ? 3.4 : 2.8
            )
          : choreo.dur
        : multi
          ? bigSummon
            ? (summonSpec?.kind === "sun" ? 3.6 : 2.8) + spec.beats!.length * 0.25
            : 1.55 + spec.beats!.length * 0.35
          : aerial
            ? 2.15 + (spec.intensity || 0.5) * 0.4
            : style === "run"
              ? 1.0 + laps * 1.1
              : style === "fly"
                ? 1.8 + laps * 1.0
                : style === "dance"
                  ? Math.max(2.8, laps * 2.2)
                  : bigSummon
                    ? summonSpec?.kind === "sun"
                      ? 4.2
                      : 3.2
                    : 1.3;

      let held: Act["held"] = null;
      // Hand-held only for throws — spray bursts from the hips at release
      if (style === "throw" && spec.projectile) {
        held = buildProjectile(spec.projectile);
        f.propHold.add(held.obj);
        held.obj.position.set(0, -0.1, 0);
      }

      acts[who] = {
        f,
        def,
        spec: { ...spec, prop },
        style,
        dmg,
        t: 0,
        dur,
        choreo,
        fired: false,
        firedBeats: new Set(),
        summoned: false,
        origin,
        dir,
        sideV,
        reach,
        startPose: { ...f.pose },
        startYOff: f.P.y - (STAND - f.pose.crouch * 0.45),
        startAngle: Math.atan2(origin.z, origin.x),
        startR: Math.max(0.6, Math.hypot(origin.x, origin.z)),
        sgn: who === 1 ? 1 : -1,
        prev: f.P.clone(),
        held,
      };
    };

    const meleeStrike = (a: Act) => {
      const at = a.def.P.clone().addScaledVector(a.dir, -0.3);
      at.y += a.style === "kick" ? 0.05 : a.style === "slam" ? -0.25 : 0.35;
      strike(a.spec, a.dmg, a.def, a.dir, at);
      if (a.style === "slam") dust(at.x, at.z, 0.8);
    };

    const runChoreo = (a: Act, dt: number) => {
      const c = a.choreo!;
      const f = a.f;
      const p = clamp01(a.t / a.dur);
      const keys = c.keys;
      let i = 0;
      while (i < keys.length - 2 && p > keys[i + 1].t) i++;
      const k0 =
        i === 0 ? { ...keys[0], pose: a.startPose, fwd: 0, side: 0, up: 0 } : keys[i];
      const k1 = keys[i + 1];
      let u = clamp01((p - k0.t) / Math.max(1e-4, k1.t - k0.t));
      u = k1.ease === "in" ? easeIn(u) : k1.ease === "out" ? easeOut(u) : easeInOut(u);
      for (const key of POSE_KEYS) f.pose[key] = lerp(k0.pose[key], k1.pose[key], u);
      const fwd = lerp(k0.fwd, k1.fwd, u) * a.reach;
      const side = lerp(k0.side, k1.side, u);
      const up = lerp(k0.up, k1.up, u);

      let jump = 0;
      if (a.style === "jump") {
        const ju = clamp01((p - 0.2) / 0.6);
        jump = (1.2 + (a.spec.intensity ?? 0.5) * 0.8) * 4 * ju * (1 - ju);
      }
      const settle = a.startYOff * (1 - smooth(0, keys[1].t, p));
      f.P.set(
        a.origin.x + a.dir.x * fwd + a.sideV.x * side,
        STAND - f.pose.crouch * 0.45 + up + jump + settle,
        a.origin.z + a.dir.z * fwd + a.sideV.z * side
      );
      f.yaw = lerpAngle(f.yaw, faceYaw(f.P, a.def.P), damp(14, dt));

      if (!a.fired && c.hitAt != null && p >= c.hitAt) {
        a.fired = true;
        meleeStrike(a);
      }
      if (!a.fired && c.releaseAt != null && p >= c.releaseAt) {
        a.fired = true;
        if (a.spec.summon && !a.summoned) {
          a.summoned = true;
          spawnSummon(a, a.spec.summon);
        } else if (
          a.spec.projectile ||
          a.dmg > 0 ||
          a.style === "shoot" ||
          a.style === "cast" ||
          a.style === "spray"
        ) {
          fireProjectile(a);
        } else {
          const front = f.P.clone().addScaledVector(a.dir, 0.7);
          emit(front, 30, 0xffe566, { speed: 1.5, up: 1.5, gravity: -1, life: 0.9 });
        }
      }
    };

    // ——— Summons (dog bite, airplane crash, etc.) ———
    const summons: SummonEnt[] = [];
    let camPull = 0; // extra camera distance for huge vehicles

    const isVehicleKind = (k: AnimSummon["kind"]) =>
      k === "plane" || k === "car" || k === "truck" || k === "tank";
    const isCelestialKind = (k: AnimSummon["kind"]) => k === "sun";
    const isMassiveKind = (k: AnimSummon["kind"]) => isVehicleKind(k) || isCelestialKind(k);

    const buildSummonMesh = (spec: AnimSummon) => {
      const g = new THREE.Group();
      const color = parseColor(spec.color, 0x8b5a2b);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.7,
        metalness: isVehicleKind(spec.kind) ? 0.45 : 0.1,
      });
      const glass = new THREE.MeshStandardMaterial({
        color: 0x7ec8e3,
        roughness: 0.15,
        metalness: 0.6,
        transparent: true,
        opacity: 0.75,
      });
      const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, metalness: 0.2 });
      const s = Math.max(0.2, spec.scale);

      if (spec.kind === "sun") {
        // Sky-filling star — radius ~0.5*scale so scale 58 ≈ 58-unit ball vs ~2-unit fighters
        const core = new THREE.Mesh(
          new THREE.SphereGeometry(0.48 * s, 28, 20),
          new THREE.MeshStandardMaterial({
            color: 0xffe566,
            emissive: 0xff9a1a,
            emissiveIntensity: 2.4,
            roughness: 0.35,
            metalness: 0.05,
          })
        );
        const corona = new THREE.Mesh(
          new THREE.SphereGeometry(0.62 * s, 20, 16),
          new THREE.MeshBasicMaterial({
            color: 0xffb020,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
          })
        );
        const haze = new THREE.Mesh(
          new THREE.SphereGeometry(0.85 * s, 16, 12),
          new THREE.MeshBasicMaterial({
            color: 0xff6a00,
            transparent: true,
            opacity: 0.12,
            depthWrite: false,
          })
        );
        const light = new THREE.PointLight(0xffc040, 4.5, 80 + s, 1.4);
        light.position.set(0, 0, 0);
        g.add(core, corona, haze, light);
        g.userData.sunSpin = true;
      } else if (spec.kind === "plane") {
        // Airliner-ish proportions — scale ~14 dwarfs ~2-unit fighters
        const fuse = new THREE.Mesh(new THREE.CapsuleGeometry(0.18 * s, 1.1 * s, 6, 12), mat);
        fuse.rotation.z = Math.PI / 2;
        fuse.position.set(0, 0.22 * s, 0);
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16 * s, 0.35 * s, 10), mat);
        nose.rotation.z = -Math.PI / 2;
        nose.position.set(0.72 * s, 0.22 * s, 0);
        const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.12 * s, 10, 8), glass);
        cockpit.scale.set(1.2, 0.7, 0.9);
        cockpit.position.set(0.45 * s, 0.32 * s, 0);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.28 * s, 0.035 * s, 1.55 * s), mat);
        wing.position.set(-0.05 * s, 0.18 * s, 0);
        const engL = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.08 * s, 0.28 * s, 10), dark);
        engL.rotation.z = Math.PI / 2;
        engL.position.set(-0.05 * s, 0.08 * s, 0.38 * s);
        const engR = engL.clone();
        engR.position.z = -0.38 * s;
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22 * s, 0.32 * s, 0.04 * s), mat);
        tail.position.set(-0.55 * s, 0.4 * s, 0);
        const stab = new THREE.Mesh(new THREE.BoxGeometry(0.14 * s, 0.03 * s, 0.45 * s), mat);
        stab.position.set(-0.55 * s, 0.28 * s, 0);
        g.add(fuse, nose, cockpit, wing, engL, engR, tail, stab);
      } else if (spec.kind === "car" || spec.kind === "truck" || spec.kind === "tank") {
        const long = spec.kind === "truck" ? 1.15 : spec.kind === "tank" ? 0.95 : 0.85;
        const tall = spec.kind === "truck" ? 0.42 : spec.kind === "tank" ? 0.32 : 0.28;
        const wide = spec.kind === "tank" ? 0.55 : 0.42;
        const body = new THREE.Mesh(new THREE.BoxGeometry(long * s, tall * s, wide * s), mat);
        body.position.y = tall * s * 0.55;
        g.add(body);
        if (spec.kind === "car" || spec.kind === "truck") {
          const cabinH = spec.kind === "truck" ? 0.28 : 0.22;
          const cabin = new THREE.Mesh(
            new THREE.BoxGeometry((spec.kind === "truck" ? 0.35 : 0.4) * s, cabinH * s, (wide - 0.06) * s),
            glass
          );
          cabin.position.set(spec.kind === "truck" ? 0.28 * s : 0.05 * s, tall * s + cabinH * s * 0.35, 0);
          g.add(cabin);
        } else {
          const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.2 * s, 0.16 * s, 12), mat);
          turret.position.y = tall * s + 0.12 * s;
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * s, 0.05 * s, 0.55 * s, 8), dark);
          barrel.rotation.z = Math.PI / 2;
          barrel.position.set(0.35 * s, tall * s + 0.14 * s, 0);
          g.add(turret, barrel);
        }
        const wheelR = spec.kind === "tank" ? 0.1 * s : 0.11 * s;
        for (const [x, z] of [
          [long * 0.32, wide * 0.48],
          [long * 0.32, -wide * 0.48],
          [-long * 0.32, wide * 0.48],
          [-long * 0.32, -wide * 0.48],
        ] as const) {
          const wh = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.08 * s, 10), dark);
          wh.rotation.x = Math.PI / 2;
          wh.position.set(x * s, wheelR, z * s);
          g.add(wh);
        }
      } else if (spec.kind === "dog" || spec.kind === "wolf") {
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22 * s, 0.35 * s, 4, 8), mat);
        body.rotation.z = Math.PI / 2;
        body.position.set(0, 0.28 * s, 0);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.16 * s, 10, 8), mat);
        head.position.set(0.32 * s, 0.34 * s, 0);
        const snout = new THREE.Mesh(new THREE.ConeGeometry(0.07 * s, 0.16 * s, 8), mat);
        snout.rotation.z = -Math.PI / 2;
        snout.position.set(0.46 * s, 0.3 * s, 0);
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.04 * s, 0.2 * s, 3, 6), mat);
        tail.position.set(-0.32 * s, 0.32 * s, 0);
        tail.rotation.z = 0.6;
        for (const [x, z] of [
          [0.14, 0.1],
          [0.14, -0.1],
          [-0.14, 0.1],
          [-0.14, -0.1],
        ] as const) {
          const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.05 * s, 0.18 * s, 3, 6), mat);
          leg.position.set(x * s, 0.12 * s, z * s);
          g.add(leg);
        }
        g.add(body, head, snout, tail);
      } else if (spec.kind === "cat") {
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.14 * s, 0.22 * s, 4, 8), mat);
        body.rotation.z = Math.PI / 2;
        body.position.set(0, 0.2 * s, 0);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.12 * s, 10, 8), mat);
        head.position.set(0.22 * s, 0.26 * s, 0);
        const earL = new THREE.Mesh(new THREE.ConeGeometry(0.04 * s, 0.1 * s, 6), mat);
        earL.position.set(0.2 * s, 0.38 * s, 0.06 * s);
        const earR = earL.clone();
        earR.position.z = -0.06 * s;
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.025 * s, 0.28 * s, 3, 6), mat);
        tail.position.set(-0.22 * s, 0.28 * s, 0);
        tail.rotation.z = 0.9;
        g.add(body, head, earL, earR, tail);
      } else if (spec.kind === "bird") {
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.14 * s, 10, 8), mat);
        body.scale.set(1.2, 0.8, 1);
        body.position.y = 0.4 * s;
        const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.35 * s, 0.04 * s, 0.16 * s), mat);
        wingL.position.set(0, 0.42 * s, 0.18 * s);
        const wingR = wingL.clone();
        wingR.position.z = -0.18 * s;
        g.add(body, wingL, wingR);
      } else if (spec.kind === "drone") {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.28 * s, 0.08 * s, 0.28 * s), mat);
        body.position.y = 0.35 * s;
        for (const [x, z] of [
          [0.18, 0.18],
          [0.18, -0.18],
          [-0.18, 0.18],
          [-0.18, -0.18],
        ] as const) {
          const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.1 * s, 0.02 * s, 12), dark);
          rotor.position.set(x * s, 0.4 * s, z * s);
          g.add(rotor);
        }
        g.add(body);
      } else if (spec.kind === "golem") {
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55 * s, 0.7 * s, 0.4 * s), mat);
        torso.position.y = 0.85 * s;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.35 * s, 0.32 * s, 0.32 * s), mat);
        head.position.y = 1.4 * s;
        const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18 * s, 0.55 * s, 0.18 * s), mat);
        armL.position.set(0, 0.85 * s, 0.35 * s);
        const armR = armL.clone();
        armR.position.z = -0.35 * s;
        g.add(torso, head, armL, armR);
      } else if (spec.kind === "blob") {
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.32 * s, 12, 10), mat);
        body.scale.set(1.2, 0.75, 1.1);
        body.position.y = 0.22 * s;
        g.add(body);
      } else {
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.28 * s, 12, 10), mat);
        body.position.y = 0.28 * s;
        g.add(body);
      }
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = spec.kind !== "sun";
          o.receiveShadow = spec.kind !== "sun";
        }
      });
      return g;
    };

    const spawnSummon = (a: Act, summon: AnimSummon) => {
      const root = buildSummonMesh(summon);
      const vehicle = isVehicleKind(summon.kind);
      const celestial = isCelestialKind(summon.kind);
      const massive = isMassiveKind(summon.kind);
      const sc = Math.max(0.2, summon.scale);
      const fromDir = a.dir.clone().negate();
      if (fromDir.lengthSq() < 0.01) fromDir.set(a.sgn, 0, 0);
      fromDir.normalize();

      if (summon.kind === "sun") {
        // Dominate the sky — full size, hanging over the ring
        root.position.set(a.def.P.x * 0.3, 14 + sc * 0.55, a.def.P.z * 0.3);
        root.scale.setScalar(0.15);
        camPull = Math.max(camPull, 22 + sc * 0.55);
      } else if (summon.kind === "plane") {
        // Dive in from far + high — already full size (no pop-in toy scale)
        root.position.copy(a.def.P);
        root.position.addScaledVector(fromDir, 18 + sc * 0.9);
        root.position.y = 6 + sc * 0.45;
        root.scale.setScalar(1);
        camPull = Math.max(camPull, 10 + sc * 0.85);
      } else if (vehicle) {
        root.position.copy(a.def.P);
        root.position.addScaledVector(fromDir, 10 + sc * 0.7);
        root.position.y = 0;
        root.scale.setScalar(1);
        camPull = Math.max(camPull, 4 + sc * 0.55);
      } else {
        root.position.copy(a.f.P);
        root.position.y = 0;
        root.position.addScaledVector(a.dir, 0.55);
        root.position.addScaledVector(a.sideV, a.sgn * 0.35);
        root.scale.setScalar(0.05);
      }

      const face = new THREE.Vector3().subVectors(a.def.P, root.position).setY(0);
      if (face.lengthSq() > 0.01) root.rotation.y = Math.atan2(face.x, face.z);

      scene.add(root);
      summons.push({
        root,
        spec: summon,
        owner: a.f,
        def: a.def,
        phase: vehicle || celestial ? "run" : "appear",
        t: 0,
        hit: false,
        dmg: a.dmg,
        anim: a.spec,
      });
      // Sun swells in during run; seed a bloom of sparks
      if (summon.kind === "sun") {
        emit(root.position.clone(), 28, 0xffaa33, { speed: 4, up: 2, life: 0.8 });
      } else {
        emit(root.position.clone().setY(Math.max(0.4, root.position.y * 0.3)), massive ? 8 : 14, parseColor(summon.color), {
          speed: massive ? 1 : 2,
          up: massive ? 0.5 : 1.5,
          life: 0.5,
        });
      }
    };

    const updateSummons = (dt: number) => {
      let biggest = 0;
      for (const s of [...summons]) {
        s.t += dt;
        const vehicle = isVehicleKind(s.spec.kind);
        const celestial = isCelestialKind(s.spec.kind);
        const sc = Math.max(0.2, s.spec.scale);
        biggest = Math.max(biggest, celestial ? sc : vehicle ? sc : sc * 0.35);

        const to = new THREE.Vector3().subVectors(s.def.P, s.root.position);
        const flat = to.clone();
        flat.y = 0;
        const dist = flat.length();
        const dist3 = to.length();
        if (dist > 0.01 && !celestial) {
          flat.normalize();
          s.root.rotation.y = Math.atan2(flat.x, flat.z);
        }

        const hitRadius =
          s.spec.kind === "sun"
            ? 2.5 + sc * 0.42
            : s.spec.kind === "plane"
              ? 1.8 + sc * 0.12
              : vehicle
                ? 1.2 + sc * 0.15
                : 0.85;

        if (s.phase === "appear") {
          const u = clamp01(s.t / 0.25);
          s.root.scale.setScalar(easeOut(u));
          s.root.position.y = Math.sin(u * Math.PI) * 0.35;
          if (u >= 1) {
            s.phase = "run";
            s.t = 0;
            s.root.position.y = 0;
          }
        } else if (s.phase === "run") {
          if (s.spec.kind === "sun") {
            // Swell to full size in the sky, then crash down onto the ring
            const swell = clamp01(s.t / 0.55);
            s.root.scale.setScalar(THREE.MathUtils.lerp(0.15, 1, easeOut(swell)));
            s.root.rotation.y += dt * 0.35;
            const target = s.def.P.clone();
            target.y = 0.6 + sc * 0.35;
            const drop = clamp01((s.t - 0.4) / 1.8);
            s.root.position.lerp(target, damp(0.55 + drop * 1.8, dt));
            if (Math.random() < 0.55) {
              emit(s.root.position.clone(), 2, 0xffaa33, {
                speed: 2 + sc * 0.04,
                up: -1,
                gravity: -2,
                life: 0.55,
              });
            }
            camPull = Math.max(camPull, 20 + sc * 0.5);
            if (dist3 < hitRadius || s.root.position.y < sc * 0.45) {
              s.phase = "attack";
              s.t = 0;
            }
            if (s.t > 4.2) {
              s.phase = "fade";
              s.t = 0;
            }
          } else if (s.spec.kind === "plane") {
            // Diving crash path toward the defender
            const speed = 14 + sc * 0.35;
            const dive = clamp01(s.t / 1.6);
            s.root.position.addScaledVector(flat, speed * dt);
            const targetY = 0.35 * sc;
            s.root.position.y = THREE.MathUtils.lerp(s.root.position.y, targetY, damp(2.2, dt));
            s.root.rotation.x = -0.35 + dive * 0.55;
            s.root.rotation.z = Math.sin(s.t * 3) * 0.08;
            if (dist < hitRadius || s.root.position.y < targetY + 0.4) {
              s.phase = "attack";
              s.t = 0;
            }
            if (s.t > 3.5) {
              s.phase = "fade";
              s.t = 0;
            }
          } else if (vehicle) {
            const speed = s.spec.kind === "tank" ? 6 : 9;
            s.root.position.addScaledVector(flat, speed * dt);
            s.root.position.y = 0;
            s.root.rotation.z = Math.sin(s.t * 10) * 0.03;
            if (dist < hitRadius) {
              s.phase = "attack";
              s.t = 0;
            }
            if (s.t > 3.2) {
              s.phase = "fade";
              s.t = 0;
            }
          } else {
            const speed = s.spec.kind === "bird" || s.spec.kind === "drone" ? 7 : 5.5;
            s.root.position.addScaledVector(flat, speed * dt);
            s.root.position.y =
              s.spec.kind === "bird" || s.spec.kind === "drone"
                ? 0.55 + Math.sin(s.t * 14) * 0.12
                : Math.abs(Math.sin(s.t * 16)) * 0.08;
            const gait = Math.sin(s.t * 18);
            s.root.rotation.z = gait * 0.12;
            if (dist < hitRadius) {
              s.phase = "attack";
              s.t = 0;
            }
            if (s.t > 2.8) {
              s.phase = "fade";
              s.t = 0;
            }
          }
        } else if (s.phase === "attack") {
          const crash = s.spec.attack === "crash" || vehicle || celestial;
          const u = clamp01(s.t / (celestial ? 0.85 : crash ? 0.55 : 0.35));
          if (crash) {
            if (celestial) {
              s.root.position.y = Math.max(sc * 0.25, s.root.position.y - dt * 6);
              s.root.scale.setScalar(1 + u * 0.15);
              s.root.rotation.y += dt * 1.2;
            } else {
              s.root.position.addScaledVector(flat, (vehicle && s.spec.kind === "plane" ? 8 : 5) * dt);
              s.root.position.y = Math.max(0, s.root.position.y - dt * (s.spec.kind === "plane" ? 4 : 0));
              s.root.rotation.x = (s.spec.kind === "plane" ? 0.5 : 0.15) * u;
              s.root.rotation.z = (Math.random() - 0.5) * 0.4 * u;
            }
            if (u > 0.15 && !s.hit) {
              s.hit = true;
              const at = s.def.P.clone();
              at.y += 0.2;
              const dir = flat.lengthSq() > 0.01 ? flat.clone() : new THREE.Vector3(1, 0, 0);
              const boom = celestial ? 80 + Math.floor(sc) : 40 + Math.floor(sc * 2);
              emit(at, boom, celestial ? 0xffcc44 : 0xffaa44, {
                speed: 5 + sc * (celestial ? 0.08 : 0.15),
                up: celestial ? 4 : 2.5,
                life: celestial ? 1.2 : 0.9,
              });
              dust(at.x, at.z, celestial ? 2.5 : 1.2 + sc * 0.08);
              if (s.dmg > 0) {
                const crashAnim: AnimSpec = {
                  ...s.anim,
                  reaction: "launch",
                  force: Math.min(1, celestial ? 1 : 0.55 + sc * 0.02),
                };
                strike(crashAnim, s.dmg, s.def, dir, at, celestial ? 0xffdd66 : 0xff8844);
              } else {
                s.def.recoilVel -= celestial ? 14 : 8;
              }
              shake = Math.max(shake, celestial ? 0.55 : 0.22 + Math.min(0.35, sc * 0.02));
              camPull = Math.max(camPull, celestial ? 28 + sc * 0.35 : 8 + sc * 0.5);
            }
            if (u >= 1) {
              s.phase = "fade";
              s.t = 0;
            }
          } else {
            s.root.position.addScaledVector(flat, 3.5 * dt);
            s.root.position.y = Math.sin(u * Math.PI) * 0.55;
            s.root.rotation.x = -u * 0.6;
            if (u > 0.45 && !s.hit) {
              s.hit = true;
              const at = s.def.P.clone();
              at.y += 0.3;
              const dir = new THREE.Vector3().subVectors(s.def.P, s.owner.P).setY(0);
              if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
              dir.normalize();
              if (s.dmg > 0) strike(s.anim, s.dmg, s.def, dir, at, parseColor(s.spec.color));
              else {
                s.def.recoilVel -= 3;
                emit(at, 12, parseColor(s.spec.color), { speed: 2.5, up: 1, life: 0.45 });
              }
              shake = Math.max(shake, 0.1);
            }
            if (u >= 1) {
              s.phase = "fade";
              s.t = 0;
            }
          }
        } else {
          const fadeT = celestial ? 1.1 : vehicle ? 0.7 : 0.4;
          const u = clamp01(s.t / fadeT);
          s.root.scale.setScalar(Math.max(0.01, 1 - u));
          if (celestial) {
            s.root.position.y += dt * 2;
            for (const c of s.root.children) {
              if (c instanceof THREE.PointLight) c.intensity = Math.max(0, 4.5 * (1 - u));
            }
          } else if (vehicle) {
            s.root.position.y += dt * (s.spec.kind === "plane" ? 0.2 : 0.4);
            s.root.rotation.z += dt * 1.2;
          } else {
            s.root.position.y += dt * 0.8;
          }
          if (u >= 1) {
            scene.remove(s.root);
            s.root.traverse((o) => {
              if (o instanceof THREE.Mesh) {
                o.geometry.dispose();
                (o.material as THREE.Material).dispose();
              }
              if (o instanceof THREE.Light) o.dispose?.();
            });
            summons.splice(summons.indexOf(s), 1);
          }
        }
      }
      // Ease camera pull toward biggest live summon, then release
      const want = summons.length ? Math.min(55, 2 + biggest * 0.7) : 0;
      camPull = THREE.MathUtils.lerp(camPull, want, damp(1.6, dt));
    };

    const poseForBeatStyle = (style: AnimStyle, amt: number): Pose => {
      const a = clamp01(amt);
      if (style === "kick") {
        return {
          ...NEUTRAL,
          lRx: -1.7 * a,
          lLx: 0.25 * a,
          pitch: -0.35 * a,
          aLx: -1.2 * a,
          aRx: 0.3 * a,
          twist: -0.2 * a,
          crouch: 0.08 * a,
        };
      }
      if (style === "punch") {
        return {
          ...NEUTRAL,
          aRx: -1.65 * a,
          aLx: -0.9 * a,
          twist: -0.4 * a,
          pitch: 0.2 * a,
          lLx: -0.45 * a,
          lRx: 0.35 * a,
        };
      }
      if (style === "spray") {
        return {
          ...NEUTRAL,
          crouch: 0.2 * a,
          pitch: 0.45 * a,
          aLz: -1.0 * a,
          aRz: 1.0 * a,
          aLx: 0.2 * a,
          aRx: 0.2 * a,
          lLx: -0.4 * a,
          lRx: 0.3 * a,
        };
      }
      if (style === "cast" || style === "spawn") {
        return {
          ...NEUTRAL,
          aLx: -2.4 * a,
          aRx: -2.4 * a,
          aLz: -0.35 * a,
          aRz: 0.35 * a,
          pitch: -0.1 * a,
          crouch: 0.1 * a,
        };
      }
      if (style === "shove") {
        return {
          ...NEUTRAL,
          aLx: -1.5 * a,
          aRx: -1.5 * a,
          pitch: 0.3 * a,
          crouch: 0.12 * a,
          lLx: -0.5 * a,
          lRx: 0.4 * a,
        };
      }
      if (style === "block") {
        return { ...BLOCK_POSE };
      }
      return {
        ...NEUTRAL,
        aRx: -1.2 * a,
        aLx: -0.6 * a,
        pitch: 0.15 * a,
      };
    };

    /** Ground multi-action combo — kick then spray, summon then bite, etc. */
    const runComboBeats = (a: Act, dt: number) => {
      const f = a.f;
      const p = clamp01(a.t / a.dur);
      const beats = a.spec.beats || [];
      // Step in during early beats, hold for projectiles/summons
      const approach = easeOut(clamp01(p / 0.35)) * Math.min(a.reach || 1.1, 1.35);
      f.P.set(
        a.origin.x + a.dir.x * approach,
        STAND,
        a.origin.z + a.dir.z * approach
      );
      f.yaw = lerpAngle(f.yaw, faceYaw(f.P, a.def.P), damp(14, dt));
      f.walkAmp = 0;

      // Blend toward the nearest upcoming / active beat pose
      let pose = { ...GUARD };
      for (const b of beats) {
        const width = 0.22;
        const amt = Math.exp(-Math.pow((p - b.at) / width, 2)) * 1.15;
        if (amt < 0.05) continue;
        const target = poseForBeatStyle(b.style, Math.min(1, amt));
        for (const key of POSE_KEYS) {
          pose[key] = lerp(pose[key], target[key], Math.min(1, amt));
        }
      }
      lerpPose(f.pose, pose, damp(18, dt));

      for (let i = 0; i < beats.length; i++) {
        const b = beats[i];
        if (p < b.at || a.firedBeats.has(i)) continue;
        a.firedBeats.add(i);
        triggerBeat(a, b);
      }
    };

    const triggerBeat = (a: Act, b: AnimBeat) => {
      if (b.summon && !a.summoned) {
        a.summoned = true;
        spawnSummon(a, b.summon);
      }
      if (
        b.projectile ||
        ((b.style === "spray" || b.style === "throw" || b.style === "cast") && !b.summon)
      ) {
        const prev = a.spec.projectile;
        if (b.projectile) a.spec = { ...a.spec, projectile: b.projectile };
        // Temporarily treat as spray/throw for muzzle origin
        const prevStyle = a.style;
        a.style = b.style === "spray" ? "spray" : b.style === "cast" ? "cast" : "throw";
        fireProjectile(a);
        a.style = prevStyle;
        if (prev !== undefined) a.spec = { ...a.spec, projectile: prev };
      } else if (
        b.hits !== false &&
        (b.style === "kick" ||
          b.style === "punch" ||
          b.style === "shove" ||
          b.style === "slam" ||
          b.style === "whip" ||
          b.style === "slash")
      ) {
        const at = a.def.P.clone().addScaledVector(a.dir, -0.25);
        at.y += b.style === "kick" ? 0.15 : 0.4;
        strike(a.spec, a.dmg, a.def, a.dir, at);
        emit(at, 14, 0xffe566, { speed: 3, up: 1.2, life: 0.45, dir: a.dir, push: 1.5 });
        shake = Math.max(shake, 0.08 + a.dmg * 0.01);
      }
    };

    /** One continuous aerial attack: rise → strike mid-air → land */
    const runAerialCombo = (a: Act, dt: number) => {
      const f = a.f;
      const p = clamp01(a.t / a.dur);
      const air = a.spec.airAction || "kick";
      const peak = air === "spray" ? 2.55 : 2.95;
      const dist = Math.hypot(a.def.P.x - a.origin.x, a.def.P.z - a.origin.z);
      const contact = Math.max(0.55, dist - (air === "kick" ? 0.85 : air === "spray" ? 1.1 : 0.75));

      // Path: leap toward foe, strike at apex, coast past, drop
      const rise = easeOut(clamp01(p / 0.38));
      const hang = smooth(0.32, 0.62, p);
      const drop = easeIn(clamp01((p - 0.62) / 0.38));
      const along = easeInOut(clamp01(p / 0.55)) * contact + smooth(0.5, 1, p) * 1.15;
      const bank = Math.sin(clamp01(p / 0.5) * Math.PI) * 0.35;

      let y: number;
      if (p < 0.38) y = STAND + rise * peak;
      else if (p < 0.62) y = STAND + peak - hang * 0.25;
      else y = STAND + (peak - 0.25) * (1 - drop);

      f.P.set(
        a.origin.x + a.dir.x * along + a.sideV.x * bank,
        y,
        a.origin.z + a.dir.z * along + a.sideV.z * bank
      );
      f.yaw = lerpAngle(f.yaw, faceYaw(f.P, a.def.P), damp(12, dt));
      f.walkAmp = 0;

      // Body language across the same arc
      const windup = clamp01((0.32 - p) / 0.32);
      const striking = smooth(0.36, 0.48, p) * (1 - smooth(0.55, 0.7, p));
      const landing = smooth(0.72, 1, p);

      let pose: Pose = {
        ...NEUTRAL,
        crouch: windup * 0.35 + landing * 0.25,
        pitch: -0.35 * windup + 0.15 * striking - 0.1 * landing,
        aLx: -0.4,
        aRx: -0.4,
        lLx: -0.3,
        lRx: -0.2,
      };

      if (air === "kick") {
        pose = {
          ...pose,
          pitch: -0.2 * windup - 0.55 * striking,
          lRx: -1.1 * windup - 1.85 * striking,
          lLx: 0.35 * striking,
          aLx: -1.6 * striking,
          aRx: 0.4 * striking,
          aLz: -0.5 * striking,
          aRz: 0.7 * striking,
          twist: -0.35 * striking,
          roll: 0.2 * striking,
        };
      } else if (air === "punch" || air === "shove") {
        pose = {
          ...pose,
          aRx: -0.6 * windup - 1.75 * striking,
          aLx: -1.0 * striking,
          twist: -0.4 * striking,
          pitch: 0.25 * striking,
          lLx: -0.5 * striking,
          lRx: 0.4 * striking,
        };
      } else if (air === "spray") {
        pose = {
          ...pose,
          crouch: 0.15 + 0.25 * striking,
          pitch: -0.25 * windup + 0.55 * striking,
          aLx: 0.4 * windup - 0.2 * striking,
          aRx: 0.4 * windup - 0.2 * striking,
          aLz: -0.9 - 0.35 * striking,
          aRz: 0.9 + 0.35 * striking,
          lLx: -0.55 * striking,
          lRx: 0.4 * striking,
          headX: -0.15 * striking,
        };
      } else if (air === "whip" || air === "slash") {
        pose = {
          ...pose,
          aRx: -2.4 * windup - 0.4 * striking,
          aRz: 0.4 * windup - 1.5 * striking,
          propX: -1.0 * windup + 0.6 * striking,
          twist: 0.5 * windup - 0.55 * striking,
          pitch: 0.2 * striking,
        };
      } else if (air === "slam") {
        pose = {
          ...pose,
          aLx: -2.8 * striking,
          aRx: -2.8 * striking,
          pitch: 0.55 * striking,
          crouch: 0.2 * landing,
        };
      } else {
        // throw / cast / default
        pose = {
          ...pose,
          aRx: -2.5 * windup - 0.8 * striking,
          aLx: -1.2 * striking,
          twist: 0.45 * windup - 0.4 * striking,
          pitch: 0.2 * striking,
        };
      }

      lerpPose(f.pose, pose, damp(16, dt));

      // Camera pulls with the leap
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, 4.0 + (y - STAND) * 0.45, 0.08);
      camera.position.z = THREE.MathUtils.lerp(camera.position.z, 8.6 + (y - STAND) * 0.25, 0.06);

      if (!a.fired && p >= 0.46) {
        a.fired = true;
        if (air === "spray" || air === "throw" || air === "cast" || air === "shoot" || a.spec.projectile) {
          // Fire from current mid-air pelvis / hands
          fireProjectile(a);
        } else {
          const at = a.def.P.clone().addScaledVector(a.dir, -0.25);
          at.y += air === "kick" ? 0.4 : 0.55;
          strike(a.spec, a.dmg, a.def, a.dir, at);
          emit(at, 18, 0xffe566, { speed: 3.5, up: 1.5, life: 0.5, dir: a.dir, push: 2 });
        }
        shake = Math.max(shake, 0.1 + a.dmg * 0.015);
      }

      if (p > 0.88 && drop > 0.7 && Math.random() < 0.4) {
        dust(f.P.x, f.P.z, 0.35);
      }
    };

    const runProcedural = (a: Act, dt: number) => {
      const f = a.f;
      const p = clamp01(a.t / a.dur);
      const spec = a.spec;

      if (spec.beats && spec.beats.length >= 2) {
        runComboBeats(a, dt);
        return;
      }

      if (spec.airAction && (a.style === "fly" || a.style === "run" || a.style === "jump")) {
        runAerialCombo(a, dt);
        return;
      }

      if (a.style === "run" || a.style === "fly") {
        const fly = a.style === "fly";
        const laps = Math.max(0.5, Math.min(3, spec.laps || (fly ? 1 : 1.25)));
        const R = Math.max(1.2, Math.min(RING_R, spec.radius || (fly ? 2.4 : RING_R)));
        const cruise = fly
          ? smooth(0.08, 0.28, p) * (1 - smooth(0.78, 0.94, p))
          : Math.min(smooth(0, 0.12, p), 1 - smooth(0.88, 1, p));
        const travel = fly ? easeSine((p - 0.08) / 0.84) : easeSine(p);
        const ang = a.startAngle + a.sgn * laps * Math.PI * 2 * travel;
        const r = a.startR + (R - a.startR) * cruise;
        const alt = fly
          ? 2.6 * smooth(0.06, 0.24, p) * (1 - smooth(0.8, 0.97, p)) +
            Math.sin(p * Math.PI * 5) * 0.12 * cruise
          : 0;

        a.prev.copy(f.P);
        f.P.x = Math.cos(ang) * r;
        f.P.z = Math.sin(ang) * r;
        const vx = (f.P.x - a.prev.x) / Math.max(dt, 1e-4);
        const vz = (f.P.z - a.prev.z) / Math.max(dt, 1e-4);
        const sp = Math.hypot(vx, vz);
        if (sp > 0.4) f.yaw = lerpAngle(f.yaw, Math.atan2(vx, vz), damp(10, dt));
        else f.yaw = lerpAngle(f.yaw, faceYaw(f.P, a.def.P), damp(6, dt));

        if (fly) {
          const takeoff = p < 0.08 ? Math.sin((p / 0.08) * Math.PI) : 0;
          f.P.y = STAND + alt - takeoff * 0.15;
          lerpPose(
            f.pose,
            {
              ...NEUTRAL,
              aRx: lerp(-0.3, -2.95, cruise),
              aLx: lerp(-0.3, 0.25, cruise),
              aLz: -0.15,
              lLx: 0.12 + Math.sin(a.t * 9) * 0.12 * cruise,
              lRx: 0.22 - Math.sin(a.t * 9) * 0.12 * cruise,
              pitch: cruise * 1.25,
              roll: -a.sgn * cruise * 0.4,
              crouch: takeoff * 0.3,
            },
            damp(10, dt)
          );
          f.walkAmp = 0;
          if (cruise > 0.5 && Math.random() < 0.6) {
            emit(f.P, 1, 0xffffff, { speed: 0.2, up: 0, gravity: 0, life: 0.5 });
          }
        } else {
          f.gait += sp * dt * 3.6;
          const g = Math.sin(f.gait);
          f.P.y = STAND - 0.06 + Math.abs(Math.cos(f.gait)) * 0.1 * Math.min(1, sp / 3);
          lerpPose(
            f.pose,
            {
              ...NEUTRAL,
              lLx: g * 1.0,
              lRx: -g * 1.0,
              aLx: -0.5 - g * 0.9,
              aRx: -0.5 + g * 0.9,
              aLz: 0.15,
              aRz: -0.15,
              pitch: 0.1 + Math.min(0.3, sp * 0.05),
              roll: a.sgn * Math.min(0.3, sp * 0.05),
            },
            damp(18, dt)
          );
          f.walkAmp = 0;
          if (sp > 2 && Math.random() < 0.3) dust(f.P.x, f.P.z, 0);
        }
        return;
      }

      // In-place expressive moves around the agent's own spot
      const base = a.origin;
      if (a.style === "dance") {
        const beat = p * Math.PI * 2;
        f.P.set(
          base.x + a.sideV.x * Math.sin(beat * 2) * 0.45 + a.dir.x * Math.sin(beat) * 0.2,
          STAND - 0.05 + Math.abs(Math.sin(beat * 4)) * 0.18,
          base.z + a.sideV.z * Math.sin(beat * 2) * 0.45 + a.dir.z * Math.sin(beat) * 0.2
        );
        const spinPhase = smooth(0.4, 0.7, p) * Math.PI * 2;
        f.yaw = faceYaw(f.P, a.def.P) + spinPhase;
        lerpPose(
          f.pose,
          {
            ...NEUTRAL,
            aLx: -2.4 + Math.sin(beat * 4) * 0.6,
            aRx: -0.6 + Math.sin(beat * 4 + 1.5) * 0.9,
            aLz: -0.4,
            aRz: 0.6 + Math.sin(beat * 4) * 0.4,
            lLx: Math.sin(beat * 4) * 0.5,
            lRx: -Math.sin(beat * 4) * 0.5,
            roll: Math.sin(beat * 4) * 0.18,
            headX: Math.sin(beat * 8) * 0.2,
          },
          damp(16, dt)
        );
        return;
      }

      const lift = Math.sin(p * Math.PI);
      f.P.set(base.x, STAND + lift * (a.style === "flourish" ? 0.4 : 0.15), base.z);
      const faceIt = faceYaw(f.P, a.def.P);
      if (a.style === "flourish") {
        f.yaw = faceIt + easeInOut(p) * Math.PI * 2;
        lerpPose(f.pose, { ...NEUTRAL, aLz: -1.5 * lift, aRz: 1.5 * lift, pitch: -0.1 * lift }, damp(14, dt));
      } else if (a.style === "taunt") {
        f.yaw = lerpAngle(f.yaw, faceIt, damp(10, dt));
        lerpPose(
          f.pose,
          {
            ...GUARD,
            aRx: -1.4 + Math.sin(a.t * 14) * 0.45 * lift,
            aRz: -0.2,
            aLx: -0.2,
            aLz: -0.4,
            pitch: -0.18 * lift,
            headX: -0.25 * lift,
          },
          damp(12, dt)
        );
      } else {
        const color = a.style === "heal" ? 0x4ade80 : 0xffd166;
        f.yaw = lerpAngle(f.yaw, faceIt, damp(10, dt));
        lerpPose(
          f.pose,
          a.style === "heal"
            ? { ...NEUTRAL, aLx: -2.6 * lift, aRx: -2.6 * lift, aLz: -0.4, aRz: 0.4, headX: -0.4 * lift }
            : { ...NEUTRAL, aLz: -1.5 * lift, aRz: 1.5 * lift, aLx: -0.3, aRx: -0.3, crouch: 0.25 * lift, pitch: 0.15 },
          damp(12, dt)
        );
        if (Math.random() < 0.5) {
          emit(
            f.P.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, -0.8, (Math.random() - 0.5) * 0.8)),
            1,
            color,
            { speed: 0.2, up: 1.5, gravity: -1.5, life: 1 }
          );
        }
      }
    };

    // ——— Idle & physics per fighter ———
    const updateIdle = (f: Fighter, dt: number) => {
      const target = f.blocking ? BLOCK_POSE : GUARD;
      lerpPose(f.pose, target, damp(9, dt));
      const dx = f.home.x - f.P.x;
      const dz = f.home.z - f.P.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.04) {
        const step = Math.min(d, dt * 2.2);
        f.P.x += (dx / d) * step;
        f.P.z += (dz / d) * step;
        f.gait += step * 6;
      }
      f.walkAmp = lerp(f.walkAmp, d > 0.04 ? 1 : 0, damp(8, dt));
      const breathe = Math.sin(performance.now() / 1000 * 2.2 + f.id) * 0.02;
      f.P.y = lerp(f.P.y, STAND - f.pose.crouch * 0.45 + breathe, damp(10, dt));
      if (Math.abs(f.spin) > 0.6) {
        f.yaw += f.spin * dt;
        f.spin *= Math.exp(-dt * 2.2);
      } else {
        f.spin = 0;
        f.yaw = lerpAngle(f.yaw, faceYaw(f.P, other(f).P), damp(8, dt));
      }
    };

    const updatePhys = (f: Fighter, dt: number) => {
      const ph = f.phys;
      const v = ph.vel;
      const limbTarget =
        ph.state === "air" ? FLAIL : ph.state === "down" ? SPRAWL : f.blocking ? BLOCK_POSE : GUARD;
      lerpPose(f.pose, limbTarget, damp(ph.state === "air" ? 12 : 8, dt), ["pitch", "roll", "crouch"]);
      if (f.spin) {
        f.yaw += f.spin * dt;
        f.spin *= Math.exp(-dt * 2.2);
        if (Math.abs(f.spin) < 0.6) f.spin = 0;
      }

      switch (ph.state) {
        case "slide": {
          f.P.x += v.x * dt;
          f.P.z += v.z * dt;
          v.multiplyScalar(Math.exp(-dt * 5));
          const sp = Math.hypot(v.x, v.z);
          f.gait += sp * dt * 7;
          f.walkAmp = Math.min(1, sp * 0.8);
          f.pose.pitch = lerp(f.pose.pitch, GUARD.pitch, damp(8, dt));
          f.pose.roll = lerp(f.pose.roll, 0, damp(8, dt));
          f.pose.crouch = lerp(f.pose.crouch, GUARD.crouch + Math.min(0.2, sp * 0.06), damp(8, dt));
          f.P.y = lerp(f.P.y, STAND - f.pose.crouch * 0.45, damp(12, dt));
          const r = Math.hypot(f.P.x, f.P.z);
          if (r > FLOOR_R - 0.4) {
            f.P.x *= (FLOOR_R - 0.4) / r;
            f.P.z *= (FLOOR_R - 0.4) / r;
            v.multiplyScalar(0.2);
          }
          if (sp < 0.15 && Math.abs(f.recoil) < 0.05) f.ctrl = "idle";
          break;
        }
        case "air": {
          v.y -= G * dt;
          f.P.addScaledVector(v, dt);
          f.pose.pitch += ph.pitchVel * dt;
          f.pose.roll = lerp(f.pose.roll, Math.sin(f.pose.pitch) * 0.2, damp(4, dt));
          f.walkAmp = 0;
          const inRing = Math.hypot(f.P.x, f.P.z) < FLOOR_R;
          const contact = lerp(STAND, LIE_H, Math.abs(Math.sin(f.pose.pitch)));
          if (inRing && f.P.y <= contact && v.y < 0) {
            f.P.y = contact;
            const impactV = -v.y;
            dust(f.P.x, f.P.z, Math.min(1, impactV / 8));
            shake = Math.max(shake, Math.min(0.25, impactV * 0.02));
            f.squash = Math.min(0.3, impactV * 0.03);
            if (impactV > 4.5 && ph.bounces < 2) {
              v.y = impactV * 0.32;
              v.x *= 0.6;
              v.z *= 0.6;
              ph.pitchVel *= 0.45;
              ph.bounces++;
            } else {
              f.pose.pitch = wrapPi(f.pose.pitch);
              const lying =
                Math.abs(f.pose.pitch) > 0.7 || ph.reaction === "launch" || ph.reaction === "knockdown";
              v.y = 0;
              if (lying) {
                ph.state = "down";
                ph.lieTarget = (f.pose.pitch < 0 ? -1 : 1) * (Math.PI / 2);
                ph.timer = 1.0;
              } else {
                ph.state = "slide";
              }
            }
          }
          if (!inRing && f.P.y < -7) {
            f.P.set(f.home.x, 9, f.home.z);
            v.set(0, 0, 0);
            f.pose.pitch = 0;
            f.pose.roll = 0;
            ph.state = "respawn";
          }
          break;
        }
        case "fall": {
          ph.pitchVel -= (5 + 12 * Math.abs(Math.sin(f.pose.pitch))) * dt;
          f.pose.pitch += ph.pitchVel * dt;
          f.P.x += v.x * dt;
          f.P.z += v.z * dt;
          v.multiplyScalar(Math.exp(-dt * 2));
          const tilt = Math.min(Math.PI / 2, Math.abs(f.pose.pitch));
          f.P.y = lerp(STAND, LIE_H, Math.sin(tilt));
          f.pose.headX = lerp(f.pose.headX, -0.6, damp(6, dt));
          if (f.pose.pitch <= -Math.PI / 2) {
            f.pose.pitch = -Math.PI / 2;
            dust(f.P.x, f.P.z, 0.9);
            shake = Math.max(shake, 0.14);
            f.squash = 0.18;
            ph.state = "down";
            ph.lieTarget = -Math.PI / 2;
            ph.timer = 1.1;
          }
          break;
        }
        case "down": {
          f.pose.pitch = lerp(f.pose.pitch, ph.lieTarget, damp(10, dt));
          f.P.y = lerp(f.P.y, LIE_H, damp(10, dt));
          f.P.x += v.x * dt;
          f.P.z += v.z * dt;
          v.multiplyScalar(Math.exp(-dt * 5));
          ph.timer -= dt;
          if (ph.timer <= 0) {
            ph.state = "getup";
            ph.timer = 0.75;
            f.getupFrom = f.pose.pitch;
          }
          break;
        }
        case "getup": {
          ph.timer -= dt;
          const u = easeInOut(clamp01(1 - ph.timer / 0.75));
          f.pose.pitch = f.getupFrom * (1 - u);
          f.pose.crouch = Math.sin(u * Math.PI) * 0.35;
          f.P.y = lerp(LIE_H, STAND - f.pose.crouch * 0.45, u);
          if (ph.timer <= 0) {
            f.pose.pitch = 0;
            f.ctrl = "idle";
          }
          break;
        }
        case "respawn": {
          v.y -= G * dt;
          f.P.y += v.y * dt;
          f.pose.pitch = 0;
          lerpPose(f.pose, FLAIL, damp(6, dt), ["pitch", "roll", "crouch"]);
          if (f.P.y <= STAND) {
            f.P.y = STAND;
            dust(f.P.x, f.P.z, 1);
            shake = Math.max(shake, 0.22);
            f.squash = 0.3;
            f.pose.crouch = 0.4;
            ph.state = "slide";
            v.set(0, 0, 0);
          }
          break;
        }
      }
    };

    const updateProp = (f: Fighter, dt: number) => {
      const holder = f.propHold.children[0];
      const joints = (holder?.userData.joints as THREE.Group[] | undefined) ?? [];
      const armVel = (f.pose.aRx - f.prevARx) / Math.max(dt, 1e-4);
      f.prevARx = f.pose.aRx;
      if (!joints.length) return;
      const bend = Math.max(-0.45, Math.min(0.45, armVel * 0.035));
      joints.forEach((j, i) => {
        if (i === 0) return;
        j.rotation.x = lerp(j.rotation.x, bend * (0.4 + i / joints.length), damp(10 - i * 0.6, dt));
      });
    };

    // ——— Public API ———
    const setForged = (a: boolean, b: boolean) => {
      const paint = (f: Fighter, ready: boolean) => {
        for (const m of f.allMats) m.opacity = ready ? 1 : 0.38;
        f.root.scale.setScalar(ready ? 1 : 0.85);
      };
      paint(f1, a);
      paint(f2, b);
    };
    const setBlocking = (a: boolean, b: boolean) => {
      f1.blocking = a;
      f2.blocking = b;
    };
    apiRef.current = { setForged, setBlocking, play };
    // ——— Loop ———
    let raf = 0;
    let last = performance.now();
    const focus = new THREE.Vector3();

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const realDt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const dt = hitStop > 0 ? realDt * 0.06 : realDt;
      hitStop = Math.max(0, hitStop - realDt);

      for (const id of [1, 2] as PlayerId[]) {
        const a = acts[id];
        if (!a) continue;
        a.t += dt;
        if (a.choreo) runChoreo(a, dt);
        else runProcedural(a, dt);
        if (acts[id] === a && a.t >= a.dur) endAct(a);
      }

      updateSummons(dt);

      for (const f of fighters) {
        if (f.ctrl === "idle") updateIdle(f, dt);
        else if (f.ctrl === "phys") updatePhys(f, dt);
        const acc = -150 * f.recoil - 16 * f.recoilVel;
        f.recoilVel += acc * dt;
        f.recoil += f.recoilVel * dt;
        f.flash *= Math.exp(-realDt * 9);
        f.squash *= Math.exp(-dt * 10);
        f.shieldFlash *= Math.exp(-realDt * 5);
        f.shield.rotation.z += dt * (f.id === 1 ? 2.2 : -2.2);
        updateProp(f, dt);
        applyPose(f);
      }

      updateProjectiles(dt);

      for (let i = 0; i < PN; i++) {
        if (pLife[i] <= 0) continue;
        pLife[i] -= dt;
        pVel[i * 3 + 1] -= pGrav[i] * dt;
        pPos[i * 3] += pVel[i * 3] * dt;
        pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
        pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
        if (pPos[i * 3 + 1] < 0.02 && Math.hypot(pPos[i * 3], pPos[i * 3 + 2]) < FLOOR_R) {
          pPos[i * 3 + 1] = 0.02;
          pVel[i * 3] *= 0.4;
          pVel[i * 3 + 1] = 0;
          pVel[i * 3 + 2] *= 0.4;
        }
        if (pLife[i] <= 0) pPos[i * 3 + 1] = -999;
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;

      for (const d of [...decals]) {
        d.life -= realDt;
        d.grow = Math.min(1, d.grow + realDt * 9);
        const target = d.mesh.userData.targetScale as THREE.Vector3;
        d.mesh.scale.copy(target).multiplyScalar(easeOut(d.grow));
        const m = d.mesh.material as THREE.MeshStandardMaterial;
        m.opacity = Math.min(1, d.life / 1.5);
        if (d.life <= 0) {
          d.mesh.parent?.remove(d.mesh);
          d.mesh.geometry.dispose();
          m.dispose();
          decals.splice(decals.indexOf(d), 1);
        }
      }

      // Camera frames both fighters; pulls way back for airplanes / vehicles
      const visible = fighters.filter((f) => f.P.y > -1);
      focus.set(0, 0, 0);
      let spread = 0;
      let top = STAND;
      for (const f of visible) {
        focus.x += f.P.x / visible.length;
        focus.z += f.P.z / visible.length;
        spread = Math.max(spread, Math.min(7, Math.hypot(f.P.x, f.P.z)));
        top = Math.max(top, Math.min(7, f.P.y));
      }
      for (const s of summons) {
        top = Math.max(top, Math.min(28, s.root.position.y + s.spec.scale * 0.2));
        spread = Math.max(spread, Math.min(24, Math.hypot(s.root.position.x, s.root.position.z) * 0.45));
      }
      camBase.lerp(
        new THREE.Vector3(
          focus.x * 0.4,
          4.2 + (top - STAND) * 0.55 + camPull * 0.35,
          8.2 + Math.max(0, spread - 2.1) * 1.4 + camPull
        ),
        damp(2.5, realDt)
      );
      camLook.lerp(
        new THREE.Vector3(focus.x * 0.55, 1.2 + (top - STAND) * 0.45 + camPull * 0.05, focus.z * 0.3),
        damp(3, realDt)
      );
      shake *= Math.exp(-realDt * 8);
      camera.position.set(
        camBase.x + (Math.random() - 0.5) * shake,
        camBase.y + (Math.random() - 0.5) * shake,
        camBase.z
      );
      camera.lookAt(camLook);

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => {
      const nw = mount.clientWidth;
      const nh = mount.clientHeight;
      if (!nw || !nh) return;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    apiRef.current?.setForged(forged1, forged2);
  }, [forged1, forged2]);

  useEffect(() => {
    apiRef.current?.setBlocking(blocking1, blocking2);
  }, [blocking1, blocking2]);

  useEffect(() => {
    if (!actor || !anim || hitKey <= 0) return;
    apiRef.current?.play(actor, anim, damage);
  }, [actor, anim, hitKey, damage]);

  useEffect(() => {
    if (!oppActor || !oppAnim || !oppHitKey || oppHitKey <= 0) return;
    apiRef.current?.play(oppActor, oppAnim, oppDamage);
  }, [oppActor, oppAnim, oppHitKey, oppDamage]);

  return <div ref={mountRef} className="absolute inset-0" />;
}
