/**
 * The house front around the main wall: the real (e.g. anthracite garage) door as its own zone –
 * scenes can light only the door and keep the frame around it dim – the two floodlights on the
 * frame (beaming up and down) brought to life by the projector, and real pumpkins in front of it
 * with jack-o'-lantern faces and other looks projected onto them.
 */
import * as THREE from 'three';
import type { Facade, RoomObject } from '@spectrastage/shared';

type Rect = { x: number; y: number; w: number; h: number };

// ---------------------------------------------------------------------------
// Door zone
// ---------------------------------------------------------------------------
/** The door in stage meters (y down), on the main wall's rect. */
export function doorRect(f: Facade | undefined, main: Rect): Rect | null {
  const d = f?.door;
  if (!d) return null;
  return { x: main.x + d.left, y: main.y + main.h - d.bottom - d.h, w: d.w, h: d.h };
}

/** How bright the frame around the door is for a scene (1 = like the door). */
export function frameLevel(f: Facade | undefined, themeId: string, sceneId: string): number {
  if (!f?.door) return 1;
  const v = f.frame?.[`${themeId}/${sceneId}`];
  return typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 1;
}

// ---------------------------------------------------------------------------
// Floodlights
// ---------------------------------------------------------------------------
export const LAMP_MODES = ['warm', 'flicker', 'pulse', 'sweep', 'strobe', 'chase', 'colors', 'fire'] as const;
export type LampMode = (typeof LAMP_MODES)[number];

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const noise = (x: number) => {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
};

/** The mode playing at `now` (auto: changes every 25 s, the same on every projector). */
export function lampModeAt(f: Facade, now: number): LampMode | null {
  const m = f.lampFx ?? 'auto';
  if (m === 'off') return null;
  if (m !== 'auto') return m;
  const slot = Math.floor(now / 25_000);
  return LAMP_MODES[Math.floor(hash(slot * 7.31) * LAMP_MODES.length)]!;
}

/**
 * The floodlights: each beams a cone up and a cone down the facade, and its glass glows – in
 * the current mode. Drawn in stage meters (y down).
 */
export function drawLamps(g: CanvasRenderingContext2D, f: Facade, main: Rect, now: number): boolean {
  const lamps = f.lamps ?? [];
  const mode = lampModeAt(f, now);
  if (!lamps.length || !mode) return false;
  const t = now / 1000;
  const level = f.lampLevel ?? 0.8;
  g.save();
  g.globalCompositeOperation = 'lighter';
  lamps.forEach((l, i) => {
    const cx = main.x + l.x;
    const cy = main.y + main.h - l.y;
    const size = Math.max(0.04, l.size);
    let a = 1;
    let col: [number, number, number] = [255, 214, 150];
    let tilt = 0;
    switch (mode) {
      case 'warm':
        a = 0.85 + 0.08 * noise(t * 3 + i * 5);
        break;
      case 'flicker': {
        // a broken lamp: mostly on, now and then it stutters and dies for a moment
        const n = noise(t * 7 + i * 13);
        a = n > 0.82 ? 0.05 : n > 0.72 ? (Math.sin(t * 60) > 0 ? 1 : 0.1) : 0.95;
        col = [210, 230, 255];
        break;
      }
      case 'pulse':
        a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 1.4 + i * Math.PI));
        col = i % 2 ? [120, 255, 140] : [190, 90, 255];
        break;
      case 'sweep':
        tilt = Math.sin(t * 0.9 + i * 1.7) * 0.45;
        col = [255, 60, 40];
        a = 0.9;
        break;
      case 'strobe': {
        // dark, then a flash of lightning
        const ph = (t + i * 0.07) % 4.3;
        a = ph < 0.08 || (ph > 0.18 && ph < 0.24) ? 1 : 0.04;
        col = [235, 240, 255];
        break;
      }
      case 'chase':
        a = Math.floor(t * 1.6) % lamps.length === i ? 1 : 0.08;
        col = [255, 140, 30];
        break;
      case 'colors': {
        const h = (t * 0.08 + i * 0.25) % 1;
        const c = (o: number) => Math.round(255 * (0.5 + 0.5 * Math.cos(Math.PI * 2 * (h + o))));
        col = [c(0), c(0.33), c(0.67)];
        a = 0.9;
        break;
      }
      case 'fire':
        a = 0.6 + 0.4 * noise(t * 9 + i * 3) * noise(t * 3.1 + i);
        col = [255, 120 + 60 * noise(t * 5 + i), 30];
        break;
    }
    a *= level;
    if (a < 0.02) return;
    const rgba = (k: number) => `rgba(${col[0]},${col[1]},${col[2]},${Math.max(0, Math.min(1, k))})`;
    // the beams: up to the top of the wall, down to the floor, a cone each
    const up = Math.max(0.2, cy - main.y);
    const down = Math.max(0.2, main.y + main.h - cy);
    for (const [len, dir] of [
      [up, -1],
      [down, 1],
    ] as const) {
      g.save();
      g.translate(cx, cy);
      g.rotate(tilt * dir);
      const spread = 0.42 * len;
      const grad = g.createLinearGradient(0, 0, 0, dir * len);
      grad.addColorStop(0, rgba(0.55 * a));
      grad.addColorStop(0.5, rgba(0.2 * a));
      grad.addColorStop(1, rgba(0));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(-size * 0.5, 0);
      g.lineTo(size * 0.5, 0);
      g.lineTo(spread, dir * len);
      g.lineTo(-spread, dir * len);
      g.closePath();
      g.fill();
      // a soft pool where the beam hits the wall
      const pool = g.createRadialGradient(0, dir * len * 0.35, 0, 0, dir * len * 0.35, len * 0.45);
      pool.addColorStop(0, rgba(0.18 * a));
      pool.addColorStop(1, rgba(0));
      g.fillStyle = pool;
      g.fillRect(-len, dir > 0 ? 0 : -len, len * 2, len);
      g.restore();
    }
    // the glass glowing
    const halo = g.createRadialGradient(cx, cy, 0, cx, cy, size * 2.2);
    halo.addColorStop(0, rgba(a));
    halo.addColorStop(0.3, rgba(0.6 * a));
    halo.addColorStop(1, rgba(0));
    g.fillStyle = halo;
    g.fillRect(cx - size * 2.2, cy - size * 2.2, size * 4.4, size * 4.4);
  });
  g.restore();
  return true;
}

/** While setting up the front: the door and the lamps outlined on every projector. */
export function drawFacadeOutline(g: CanvasRenderingContext2D, f: Facade, main: Rect, now: number): void {
  const d = doorRect(f, main);
  const lw = Math.max(0.006, main.h / 250);
  g.save();
  g.lineWidth = lw;
  g.strokeStyle = `rgba(255, 230, 80, ${0.75 + 0.25 * Math.sin(now / 160)})`;
  g.shadowColor = '#ffe650';
  g.shadowBlur = 6;
  if (d) {
    g.setLineDash([lw * 4, lw * 2]);
    g.strokeRect(d.x, d.y, d.w, d.h);
    g.setLineDash([]);
  }
  for (const l of f.lamps ?? []) {
    const cx = main.x + l.x;
    const cy = main.y + main.h - l.y;
    g.beginPath();
    g.arc(cx, cy, Math.max(0.03, l.size / 2), 0, Math.PI * 2);
    g.moveTo(cx - l.size, cy);
    g.lineTo(cx + l.size, cy);
    g.moveTo(cx, cy - l.size);
    g.lineTo(cx, cy + l.size);
    g.stroke();
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// Real pumpkins
// ---------------------------------------------------------------------------
/** A pumpkin body (ribbed, squat ball) of the object's size, standing on y = 0. */
export function pumpkinGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.5, 72, 40);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const phi = Math.atan2(v.z, v.x);
    const rib = 1 - 0.06 * (0.5 - 0.5 * Math.cos(phi * 10));
    // a little flattened at the top (stem) and bottom
    const yy = v.y * 2;
    v.x *= rib;
    v.z *= rib;
    v.y = v.y * 0.92 - (Math.abs(yy) > 0.9 ? (Math.abs(yy) - 0.9) * 0.6 * Math.sign(yy) : 0);
    p.setXYZ(i, v.x * w, (v.y + 0.5) * h, v.z * d);
  }
  g.computeVertexNormals();
  return g;
}

export const PUMPKIN_LOOKS = ['face', 'inner', 'cracks', 'worm', 'auto'] as const;

export const PUMPKIN_VERT = /* glsl */ `
uniform vec3 uSize;
varying vec3 vDir;
void main() {
  vDir = (position - vec3(0.0, 0.5 * uSize.y, 0.0)) / uSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * What goes onto a real pumpkin (seen from its front, +z): carved faces that glow from inside
 * (four of them, talking now and then), a warm inner glow, glowing cracks spreading, a worm
 * crawling out of the mouth – or all of them in turn ('auto').
 */
export const PUMPKIN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLook;   // 0 face, 1 inner, 2 cracks, 3 worm, 4 auto
uniform float uSeed;
uniform vec3 uColor;
varying vec3 vDir;
float h1(float n) { return fract(sin(n) * 43758.5453); }
float n1(float x) { float i = floor(x); float f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
// triangle pointing up (k = 1) or down (k = -1), size s
float tri(vec2 p, float s, float k) {
  p.y *= k;
  p /= s;
  const float r3 = 1.7320508;
  p.x = abs(p.x) - 1.0;
  p.y = p.y + 1.0 / r3;
  if (p.x + r3 * p.y > 0.0) p = vec2(p.x - r3 * p.y, -r3 * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0, 0.0);
  return -length(p) * sign(p.y) * s;
}
mat2 rot(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }
/** < 0 inside a cut-out of face v (q: angles across / up the front). */
float face(vec2 q, float v, float talk) {
  vec2 e = vec2(abs(q.x), q.y);
  float d;
  if (v < 0.5) {
    // classic: triangle eyes and nose, a toothy grin
    d = tri(e - vec2(0.36, 0.2), 0.15, 1.0);
    d = min(d, tri(q - vec2(0.0, 0.0), 0.08, 1.0));
    float my = -0.27 + 0.32 * q.x * q.x;
    float mh = 0.07 * (1.0 + talk);
    float m = max(abs(q.y - my) - mh, abs(q.x) - 0.6);
    // teeth
    float tooth = step(0.5, fract(q.x * 5.0 + 0.25));
    m = max(m, -max(abs(q.y - (my + mh * (tooth > 0.5 ? 0.6 : -0.6))) - mh * 0.45, abs(q.x) - 0.55));
    d = min(d, m);
  } else if (v < 1.5) {
    // scary: slanted angry eyes, a wide jagged mouth
    vec2 pe = e - vec2(0.36, 0.22);
    pe = rot(-0.45) * pe;
    d = tri(pe, 0.16, -1.0);
    d = min(d, tri(q - vec2(0.0, 0.03), 0.07, -1.0));
    float my = -0.25 - 0.1 * cos(q.x * 4.0) + 0.06 * sign(sin(q.x * 18.0));
    d = min(d, max(abs(q.y - my) - 0.09 * (1.0 + talk * 0.8), abs(q.x) - 0.68));
  } else if (v < 2.5) {
    // happy: round eyes, a big smile
    d = length(e - vec2(0.33, 0.22)) - 0.11;
    d = min(d, length(q - vec2(0.0, 0.02)) - 0.05);
    float my = -0.3 + 0.45 * q.x * q.x;
    d = min(d, max(abs(q.y - my) - 0.06 * (1.0 + talk), abs(q.x) - 0.55));
  } else {
    // surprised: wide eyes, an O mouth
    d = length(e - vec2(0.32, 0.25)) - 0.12;
    d = min(d, length((q - vec2(0.0, -0.27)) * vec2(1.0, 0.85)) - 0.12 * (1.0 + 0.4 * talk));
  }
  return d;
}
void main() {
  vec3 d = normalize(vDir);
  vec2 q = vec2(atan(d.x, d.z), asin(clamp(d.y, -1.0, 1.0)));
  float t = uTime + uSeed * 37.0;
  float front = smoothstep(0.05, 0.4, d.z);
  float flame = 0.72 + 0.28 * n1(t * 9.0) * n1(t * 3.7 + 5.0);
  vec3 fire = mix(vec3(1.0, 0.42, 0.04), vec3(1.0, 0.82, 0.3), n1(t * 4.0 + 2.0));
  vec3 shell = uColor * 0.06;
  float look = uLook;
  float faceV = mod(floor(t / 15.0), 4.0);
  if (look > 3.5) {
    float slot = mod(floor(t / 12.0), 7.0);
    look = slot < 2.0 ? 0.0 : slot < 3.0 ? 1.0 : slot < 4.0 ? 0.0 : slot < 5.0 ? 2.0 : slot < 6.0 ? 3.0 : 0.0;
    faceV = mod(floor(t / 12.0) * 3.0, 4.0);
  }
  float talk = max(0.0, sin(t * 7.0)) * step(0.6, n1(t * 0.4));
  vec3 col = shell;
  if (look < 0.5 || look > 2.5) {
    // a carved face lit from inside (with a soft glow around the cuts)
    float c = face(q, faceV, talk);
    float cut = smoothstep(0.012, -0.01, c) * front;
    float halo = smoothstep(0.12, 0.0, c) * front * 0.25;
    col = shell + fire * flame * (cut * 1.8 + halo);
    if (look > 2.5) {
      // the worm: crawls out of the mouth and down the pumpkin, then back in
      float cyc = mod(t, 10.0) / 10.0;
      float len = 0.9 * sin(cyc * 3.14159);
      float best = 1e5;
      float sAt = 0.0;
      for (int i = 0; i < 14; i++) {
        float s = float(i) / 13.0 * len;
        vec2 pth = vec2(0.05 + s * 0.85, -0.27 - s * 0.55 + 0.05 * sin(s * 9.0 - t * 5.0));
        float r = 0.05 * (1.0 - 0.5 * float(i) / 13.0);
        float dd = length(q - pth) - r;
        if (dd < best) { best = dd; sAt = float(i); }
      }
      float w = smoothstep(0.01, -0.005, best) * front;
      vec3 wc = mix(vec3(0.35, 0.9, 0.25), vec3(0.15, 0.5, 0.1), step(0.5, fract(sAt * 0.5)));
      col = mix(col, wc * 1.2, w);
    }
  } else if (look < 1.5) {
    // glowing from inside: brighter between the ribs, flickering
    float rib = 0.5 + 0.5 * cos(atan(d.z, d.x) * 10.0);
    col = fire * flame * (0.3 + 0.5 * (1.0 - rib * 0.7)) * (0.55 + 0.45 * (1.0 - abs(q.y) / 1.6));
  } else {
    // cracks: glowing lines spreading from the top, then it bursts in light
    float grow = mod(t, 9.0) / 9.0;
    vec2 g = q * vec2(3.2, 3.2) + vec2(n1(q.y * 7.0) * 0.6, n1(q.x * 7.0 + 3.0) * 0.6);
    vec2 ip = floor(g), fp = fract(g);
    float d1 = 8.0, d2 = 8.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 cc = o + vec2(h1(dot(ip + o, vec2(7.1, 157.3))), h1(dot(ip + o, vec2(113.7, 41.9))));
      float dd = length(cc - fp);
      if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
    }
    float edge = smoothstep(0.08, 0.0, d2 - d1);
    float reach = smoothstep(0.0, 0.85, grow) * 3.2;
    float on = smoothstep(reach, reach - 0.4, 1.6 - q.y);
    col = shell + fire * flame * edge * on * 1.8 + fire * smoothstep(0.85, 1.0, grow) * 1.2;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Pumpkin look index for the shader (other looks: the inner glow). */
export function pumpkinLook(o: RoomObject): number {
  const i = (PUMPKIN_LOOKS as readonly string[]).indexOf(o.look);
  return i >= 0 ? i : 1;
}
