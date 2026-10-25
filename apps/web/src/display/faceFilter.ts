/**
 * Real face filter (like the AR lenses of photo apps): MediaPipe's 3D face mesh (468 points) is
 * covered with a painted creature texture that is shaded by the real face – the light, the
 * wrinkles, the eyebrows and every movement stay, so it looks like make-up, not like a sticker.
 * The real eyes and mouth show through. Horns, a hat, ears, a knife or an arrow are small 3D
 * models fixed to the head pose; a head-shaped occluder hides what is behind or inside the head.
 */
import * as THREE from 'three';
import { FACE_POS, FACE_TRIS, FACE_UV } from './faceMesh.ts';

export type Kind = 'zombie' | 'ghost' | 'vampire' | 'skeleton' | 'devil' | 'werewolf' | 'witch' | 'comic';
export type Mark = 'forehead' | 'cheek' | 'bandage' | 'bolts' | 'veins' | 'spots' | 'knife' | 'arrow';
/** Random creature look of one person. */
export interface Look {
  kind: Kind;
  eyes: 'yellow' | 'red' | 'milky' | 'black' | 'blue';
  marks: Mark[];
  seed: number;
}
/** A face point in picture pixels; z in the same scale (smaller = nearer to the camera). */
export interface P3 {
  x: number;
  y: number;
  z: number;
}
export interface FaceIn {
  pts: P3[];
  look: Look;
  /** Mean brightness of the skin (0..1, sRGB) – the paint is shaded relative to it. */
  lum: number;
}

// ---------------------------------------------------------------- colours of the whole person

/** Colour [r, g, b], strength 0..1 and brightness factor. */
type Grade = [number, number, number, number, number];
const ZOMBIE_SKIN: [number, number, number][] = [
  [120, 150, 105],
  [128, 140, 160],
  [150, 125, 165],
  [170, 175, 155],
  [135, 145, 85],
];
const GRADES: Partial<Record<Kind, { skin: Grade; hair: Grade }>> = {
  ghost: { skin: [225, 235, 255, 0.85, 1.45], hair: [215, 228, 255, 0.85, 1.6] },
  vampire: { skin: [240, 232, 245, 0.65, 1.25], hair: [30, 20, 40, 0.55, 0.6] },
  skeleton: { skin: [245, 245, 238, 0.7, 1.4], hair: [190, 190, 195, 0.45, 1.0] },
  devil: { skin: [205, 45, 35, 0.8, 1.0], hair: [70, 10, 10, 0.6, 0.7] },
  werewolf: { skin: [140, 95, 55, 0.6, 0.95], hair: [115, 85, 55, 0.6, 1.05] },
  witch: { skin: [115, 175, 85, 0.8, 1.0], hair: [45, 30, 65, 0.55, 0.8] },
};
const gradeCache = new Map<string, { skin: Grade; hair: Grade }>();
/**
 * The creature's colours for all skin (face, ears, neck, hands) and the hair – applied to the
 * whole person by the segmentation, so no part stays as it was (no mask look).
 */
export function lookColours(look: Look): { skin: Grade; hair: Grade } {
  const k = `${look.kind}:${look.seed}`;
  let g = gradeCache.get(k);
  if (!g) {
    const z = ZOMBIE_SKIN[look.seed % ZOMBIE_SKIN.length]!;
    g = GRADES[look.kind] ?? { skin: [z[0], z[1], z[2], 0.78, 0.95], hair: [115, 120, 105, 0.5, 0.8] };
    gradeCache.set(k, g);
    if (gradeCache.size > 64) gradeCache.delete(gradeCache.keys().next().value as string);
  }
  return g;
}

// ---------------------------------------------------------------- texture painting (UV space)

const S = 1024;

/**
 * MediaPipe's face mesh ends in the middle of the forehead. Two extra rings of points carry it on
 * up to the hairline (and a little to the temples), extrapolated away from the nose bridge (168) –
 * so the make-up covers the whole forehead and fades out at the hair, not in a hard line.
 */
const ARC = [127, 162, 21, 54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 356];
const ARC_K = [0, 0.18, 0.32, 0.46, 0.56, 0.62, 0.65, 0.66, 0.65, 0.62, 0.56, 0.46, 0.32, 0.18, 0];
const ANCHOR = 168;
const RINGS = [0.5, 1];
/** Number of mesh points with the extension. */
export const MESH_N = 468 + ARC.length * RINGS.length;
/** Extended point j (0-based after the 468) → [arc index, ring factor]. */
function extOf(j: number): [number, number] {
  const ring = Math.floor(j / ARC.length);
  return [j % ARC.length, RINGS[ring]!];
}
/** Extrapolates the extra points from the real ones (works for uv and for picture points). */
function extend<T extends { x: number; y: number; z?: number }>(get: (i: number) => T, j: number): T {
  const [a, f] = extOf(j);
  const p = get(ARC[a]!);
  const c = get(ANCHOR);
  const k = ARC_K[a]! * f;
  const out = { ...p, x: p.x + (p.x - c.x) * k, y: p.y + (p.y - c.y) * k } as T;
  if (p.z !== undefined && c.z !== undefined) out.z = p.z + (p.z - c.z) * k;
  return out;
}
const MESH_UV = (() => {
  const uv = new Float32Array(MESH_N * 2);
  uv.set(FACE_UV);
  const get = (i: number) => ({ x: FACE_UV[i * 2]!, y: FACE_UV[i * 2 + 1]! });
  for (let j = 0; j < MESH_N - 468; j++) {
    const q = extend(get, j);
    uv[(468 + j) * 2] = q.x;
    uv[(468 + j) * 2 + 1] = Math.max(0.002, q.y);
  }
  return uv;
})();
const MESH_TRIS = (() => {
  const t = [...FACE_TRIS];
  const id = (ring: number, a: number) => (ring < 0 ? ARC[a]! : 468 + ring * ARC.length + a);
  for (let ring = 0; ring < RINGS.length; ring++)
    for (let a = 0; a + 1 < ARC.length; a++) {
      const p0 = id(ring - 1, a);
      const p1 = id(ring - 1, a + 1);
      const q0 = id(ring, a);
      const q1 = id(ring, a + 1);
      t.push(p0, p1, q1, p0, q1, q0);
    }
  return new Uint16Array(t);
})();
const uvp = (i: number) => ({ x: MESH_UV[i * 2]! * S, y: MESH_UV[i * 2 + 1]! * S });
/** The outline of the extended face (uv indices). */
const OUTLINE = (() => {
  const top = ARC.map((_, a) => 468 + (RINGS.length - 1) * ARC.length + a);
  // the face outline from 454 down around the chin to 127, then the outer ring back over the forehead
  const lower = [
    454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234,
  ];
  return [...lower, ...top];
})();
const EYE_L = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const EYE_R = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const LIPS_OUT = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const LIPS_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
const BROW_L = [70, 63, 105, 66, 107];
const BROW_R = [300, 293, 334, 296, 336];

function rng(seed: number) {
  let x = (seed * 2654435761) >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}

function path(g: CanvasRenderingContext2D, idx: number[], k = 1, dx = 0, dy = 0) {
  const pts = idx.map(uvp);
  const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
  g.beginPath();
  pts.forEach((p, i) => {
    const x = c.x + (p.x - c.x) * k + dx;
    const y = c.y + (p.y - c.y) * k + dy;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  });
  g.closePath();
  return c;
}
function centre(idx: number[]) {
  const pts = idx.map(uvp);
  return pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
}
function spot(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, a: number, ry = r) {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / r);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
  gr.addColorStop(0, `rgba(${col},${a})`);
  gr.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
function line(g: CanvasRenderingContext2D, pts: { x: number; y: number }[], w: number, col: string) {
  g.strokeStyle = col;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.stroke();
}
/** A crack or vein: random walk from a point. */
function crack(
  g: CanvasRenderingContext2D,
  r: () => number,
  x: number,
  y: number,
  ang: number,
  len: number,
  w: number,
  col: string,
  depth = 2,
) {
  const pts = [{ x, y }];
  let a = ang;
  for (let k = 0; k < 8; k++) {
    a += (r() - 0.5) * 0.9;
    const p = pts[pts.length - 1]!;
    pts.push({ x: p.x + Math.cos(a) * (len / 8), y: p.y + Math.sin(a) * (len / 8) });
    if (depth > 0 && r() < 0.18)
      crack(
        g,
        r,
        pts[pts.length - 1]!.x,
        pts[pts.length - 1]!.y,
        a + (r() - 0.5) * 2,
        len * 0.45,
        w * 0.6,
        col,
        depth - 1,
      );
  }
  line(g, pts, w, col);
}
function stitches(
  g: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  n: number,
) {
  line(g, [a, b], 9, 'rgba(120,25,40,0.95)');
  line(g, [a, b], 3, 'rgba(200,70,80,0.8)');
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / l;
  const ny = (b.x - a.x) / l;
  for (let k = 1; k <= n; k++) {
    const u = k / (n + 1);
    const x = a.x + (b.x - a.x) * u;
    const y = a.y + (b.y - a.y) * u;
    line(
      g,
      [
        { x: x - nx * 20, y: y - ny * 20 },
        { x: x + nx * 20, y: y + ny * 20 },
      ],
      5,
      'rgba(25,15,15,0.95)',
    );
  }
}
function noise(
  g: CanvasRenderingContext2D,
  r: () => number,
  n: number,
  cols: string[],
  size: number,
  a: number,
) {
  for (let k = 0; k < n; k++) {
    const p = uvp(Math.floor(r() * 468));
    spot(
      g,
      p.x + (r() - 0.5) * 40,
      p.y + (r() - 0.5) * 40,
      size * (0.4 + r()),
      cols[k % cols.length]!,
      a * (0.4 + r() * 0.6),
    );
  }
}

/**
 * Paints the creature in the face's UV layout, in two layers: the skin tint (takes only the
 * colour – the real face's light, pores and wrinkles stay) and the make-up details (sockets, lips,
 * wounds, skull paint …), which are shaded by the real face.
 */
export function paintLook(look: Look): { tint: HTMLCanvasElement; detail: HTMLCanvasElement } {
  const tc = document.createElement('canvas');
  tc.width = tc.height = S;
  const tg = tc.getContext('2d')!;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = rng(look.seed + 7);
  const eyeL = centre(EYE_L);
  const eyeR = centre(EYE_R);
  const base = (rgb: string, a: number, tint = true) => {
    // the skin colour itself comes from the grading of the whole person (lookColours)
    if (tint) return;
    const x = g;
    x.fillStyle = `rgba(${rgb},${a})`;
    path(x, OUTLINE, 1.05);
    x.fill();
  };
  // sunken sockets around the eyes
  const sockets = (rgb: string, a: number, k = 1.9) => {
    for (const e of [EYE_L, EYE_R]) {
      const m = centre(e);
      spot(g, m.x, m.y + 6, 62 * k, rgb, a, 48 * k);
    }
  };
  const lips = (rgb: string, a: number) => {
    g.fillStyle = `rgba(${rgb},${a})`;
    path(g, LIPS_OUT, 1.04);
    g.fill();
  };
  const brows = (rgb: string, w: number, lift = 0) => {
    for (const b of [BROW_L, BROW_R])
      line(
        g,
        b.map(uvp).map((p) => ({ x: p.x, y: p.y - lift })),
        w,
        `rgb(${rgb})`,
      );
  };
  let eyeHoles = true;
  switch (look.kind) {
    case 'zombie': {
      const tones = ['120,150,105', '128,140,160', '150,125,165', '170,175,155', '135,145,85'];
      const tone = tones[look.seed % tones.length]!;
      base(tone, 0.9);
      noise(tg, r, 70, ['70,95,55', '110,80,95', '90,105,60'], 34, 0.6);
      noise(g, r, 40, ['40,55,30', '90,50,70'], 26, 0.35);
      sockets('45,15,50', 1, 2.2);
      spot(g, uvp(205).x, uvp(205).y + 10, 80, '45,35,55', 0.6);
      spot(g, uvp(425).x, uvp(425).y + 10, 80, '45,35,55', 0.6);
      for (const i of [127, 356, 58, 288]) spot(g, uvp(i).x, uvp(i).y, 90, '40,45,40', 0.5);
      lips('60,35,55', 0.85);
      if (look.marks.includes('veins'))
        for (const i of [127, 356, 67, 297]) {
          const p = uvp(i);
          crack(g, r, p.x, p.y, Math.atan2(S * 0.55 - p.y, S / 2 - p.x), 150, 5, 'rgba(40,70,80,0.7)');
        }
      if (look.marks.includes('forehead')) stitches(g, uvp(67), { x: uvp(9).x + 30, y: uvp(9).y - 10 }, 5);
      if (look.marks.includes('cheek')) {
        const a = uvp(look.seed & 1 ? 116 : 345);
        const b = uvp(look.seed & 1 ? 212 : 432);
        line(g, [a, b], 16, 'rgba(90,10,20,0.95)');
        line(g, [a, b], 6, 'rgba(210,60,60,0.9)');
      }
      if (look.marks.includes('spots')) noise(g, r, 18, ['60,70,25'], 28, 0.85);
      if (look.marks.includes('bandage')) {
        const p = uvp(151);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(look.seed & 2 ? 0.45 : -0.45);
        g.fillStyle = 'rgba(232,215,180,0.95)';
        g.fillRect(-150, -32, 300, 64);
        g.fillStyle = 'rgba(200,175,140,0.95)';
        g.fillRect(-45, -32, 90, 64);
        spot(g, 0, 0, 30, '140,20,20', 0.8);
        g.restore();
      }
      if (look.marks.includes('knife')) {
        // the wound under the knife (the knife itself is 3D)
        const p = uvp(look.seed & 1 ? 297 : 67);
        spot(g, p.x, p.y - 30, 70, '130,0,15', 0.95, 50);
        for (let k = 0; k < 3; k++)
          line(
            g,
            [
              { x: p.x - 30 + k * 30, y: p.y - 20 },
              { x: p.x - 30 + k * 30 + (r() - 0.5) * 20, y: p.y + 120 + r() * 160 },
            ],
            10 - k * 2,
            'rgba(140,0,15,0.9)',
          );
      }
      if (look.marks.includes('arrow'))
        for (const i of [127, 356]) spot(g, uvp(i).x, uvp(i).y, 45, '130,0,15', 0.9);
      break;
    }
    case 'ghost': {
      base('225,235,250', 0.8, false);
      noise(g, r, 20, ['190,205,235'], 40, 0.4);
      // big hollow black eyes and a long wailing mouth (covering the real ones)
      eyeHoles = false;
      for (const m of [eyeL, eyeR]) {
        spot(g, m.x, m.y + 30, 95, '5,5,15', 1, 135);
        spot(g, m.x, m.y + 30, 70, '0,0,5', 1, 110);
      }
      const mo = centre(LIPS_OUT);
      spot(g, mo.x, mo.y + 10, 70, '5,5,15', 1, 105);
      spot(g, mo.x, mo.y + 10, 50, '0,0,5', 1, 85);
      break;
    }
    case 'skeleton': {
      base('245,245,238', 0.88, false);
      // black sockets (the real eye glints inside), nose hole, teeth across the mouth
      for (const m of [eyeL, eyeR]) spot(g, m.x, m.y + 4, 120, '8,8,12', 1, 105);
      spot(g, uvp(205).x, uvp(205).y + 20, 75, '60,60,70', 0.55);
      spot(g, uvp(425).x, uvp(425).y + 20, 75, '60,60,70', 0.55);
      const n = uvp(4);
      g.fillStyle = 'rgba(8,8,12,1)';
      g.beginPath();
      g.moveTo(n.x, n.y - 70);
      g.quadraticCurveTo(n.x - 75, n.y + 10, n.x - 10, n.y + 40);
      g.lineTo(n.x, n.y + 20);
      g.lineTo(n.x + 10, n.y + 40);
      g.quadraticCurveTo(n.x + 75, n.y + 10, n.x, n.y - 70);
      g.fill();
      const L = uvp(61);
      const R = uvp(291);
      const mid = (L.y + R.y) / 2;
      const x0 = L.x - 70;
      const x1 = R.x + 70;
      g.fillStyle = 'rgba(250,250,240,1)';
      g.fillRect(x0, mid - 55, x1 - x0, 110);
      g.strokeStyle = 'rgba(10,10,15,1)';
      g.lineWidth = 6;
      g.strokeRect(x0, mid - 55, x1 - x0, 110);
      g.beginPath();
      g.moveTo(x0, mid);
      g.lineTo(x1, mid);
      for (let k = 1; k < 10; k++) {
        const x = x0 + ((x1 - x0) * k) / 10;
        g.moveTo(x, mid - 55);
        g.lineTo(x, mid + 55);
      }
      g.stroke();
      line(g, [uvp(132), uvp(58), uvp(172)], 8, 'rgba(40,40,50,0.6)');
      line(g, [uvp(361), uvp(288), uvp(397)], 8, 'rgba(40,40,50,0.6)');
      break;
    }
    case 'vampire': {
      base('238,232,245', 0.35, false);
      base('225,215,240', 0.6);
      sockets('70,20,60', 0.75, 1.5);
      for (const i of [50, 280]) spot(g, uvp(i).x, uvp(i).y + 30, 80, '120,90,130', 0.35);
      brows('25,10,25', 22, 6);
      lips('120,0,25', 0.92);
      const p = uvp(look.seed & 1 ? 61 : 291);
      line(
        g,
        [
          { x: p.x, y: p.y },
          { x: p.x + 4, y: p.y + 90 },
          { x: p.x + 2, y: p.y + 160 },
        ],
        12,
        'rgba(150,0,20,0.95)',
      );
      spot(g, p.x + 2, p.y + 165, 14, '150,0,20', 1);
      break;
    }
    case 'devil': {
      base('200,45,35', 0.85);
      noise(tg, r, 40, ['140,0,0', '250,90,40'], 40, 0.5);
      sockets('60,0,0', 0.8, 1.7);
      spot(g, uvp(205).x, uvp(205).y + 15, 80, '80,0,0', 0.5);
      spot(g, uvp(425).x, uvp(425).y + 15, 80, '80,0,0', 0.5);
      // sharp brows rising outwards
      for (const [b, s] of [
        [BROW_L, -1],
        [BROW_R, 1],
      ] as const) {
        const pts = b.map(uvp);
        line(
          g,
          pts.map((p, k) => ({ x: p.x, y: p.y - 10 - Math.abs(k - (s < 0 ? 4 : 0)) * 12 })),
          20,
          'rgb(20,0,0)',
        );
      }
      lips('60,0,10', 0.9);
      // goatee
      const ch = uvp(152);
      const l = uvp(17);
      g.fillStyle = 'rgba(20,5,5,0.95)';
      g.beginPath();
      g.moveTo(l.x - 70, l.y + 25);
      g.quadraticCurveTo(ch.x, l.y + 50, l.x + 70, l.y + 25);
      g.lineTo(ch.x, ch.y + 10);
      g.closePath();
      g.fill();
      break;
    }
    case 'werewolf': {
      base('140,95,55', 0.75);
      // fur strokes all over, longer at the edge of the face
      for (let k = 0; k < 2600; k++) {
        const p = uvp(Math.floor(r() * 468));
        const c0 = { x: S / 2, y: S * 0.55 };
        const a = Math.atan2(p.y - c0.y, p.x - c0.x) + (r() - 0.5) * 0.8;
        const len = 14 + r() * 26;
        const x = p.x + (r() - 0.5) * 30;
        const y = p.y + (r() - 0.5) * 30;
        line(
          g,
          [
            { x, y },
            { x: x + Math.cos(a) * len, y: y + Math.sin(a) * len },
          ],
          3,
          r() < 0.5 ? 'rgba(80,55,35,0.6)' : 'rgba(165,130,90,0.55)',
        );
      }
      sockets('40,25,15', 0.7, 1.6);
      brows('35,22,12', 30, 4);
      const n = uvp(4);
      spot(g, n.x, n.y - 10, 70, '15,10,10', 1, 55);
      lips('40,20,20', 0.85);
      break;
    }
    case 'witch': {
      base('115,175,85', 0.85);
      noise(tg, r, 30, ['60,140,40', '150,200,90'], 36, 0.5);
      sockets('70,30,90', 0.85, 1.7);
      lips('70,15,80', 0.9);
      brows('20,30,15', 16, 4);
      for (const i of [look.seed & 1 ? 48 : 278, look.seed & 2 ? 152 : 199]) {
        const p = uvp(i);
        spot(g, p.x, p.y, 22, '80,95,35', 1);
        spot(g, p.x - 6, p.y - 6, 8, '200,220,150', 0.8);
      }
      break;
    }
    default:
      break;
  }
  // soft edge towards hair, ears and neck
  const m = document.createElement('canvas');
  m.width = m.height = S;
  const mg = m.getContext('2d')!;
  mg.filter = 'blur(42px)';
  mg.fillStyle = '#fff';
  path(mg, OUTLINE, 0.94, 0, 10);
  mg.fill();
  for (const x of [tg, g]) {
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(m, 0, 0);
    // the real eyes and mouth show through
    x.globalCompositeOperation = 'destination-out';
    x.filter = 'blur(3px)';
    x.fillStyle = '#000';
    if (eyeHoles)
      for (const e of [EYE_L, EYE_R]) {
        path(x, e, 1.04);
        x.fill();
      }
    path(x, LIPS_IN, 0.98);
    x.fill();
    x.filter = 'none';
    x.globalCompositeOperation = 'source-over';
  }
  return { tint: tc, detail: c };
}

// ---------------------------------------------------------------- 3D props

function mat(color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...o });
}
/** A cone standing on y = 0 whose tip bends sideways (horns, hat tip). */
function bentCone(r: number, h: number, bendX: number, bendZ = 0, seg = 18) {
  const g = new THREE.ConeGeometry(r, h, seg, 14);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h;
    p.setX(i, p.getX(i) + bendX * t * t);
    p.setZ(i, p.getZ(i) + bendZ * t * t);
  }
  g.computeVertexNormals();
  return g;
}
function canon(i: number) {
  return new THREE.Vector3(FACE_POS[i * 3]!, FACE_POS[i * 3 + 1]!, FACE_POS[i * 3 + 2]!);
}

/** The 3D props of a look, in the canonical face space (cm, y up, z towards the camera). */
function buildProps(look: Look): { solid: THREE.Group; front: THREE.Group } {
  const solid = new THREE.Group();
  const front = new THREE.Group();
  const fangs = (len: number, lower: boolean) => {
    const top = canon(13);
    const bot = canon(14);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.32, len, 10), mat('#f6f2e6', { roughness: 0.3 }));
      if (!lower) {
        m.rotation.x = Math.PI;
        m.position.set(s * 1.05, top.y - len / 2 + 0.25, top.z + 0.2);
      } else m.position.set(s * 0.8, bot.y + len / 2 - 0.25, bot.z + 0.1);
      front.add(m);
    }
  };
  switch (look.kind) {
    case 'devil': {
      for (const s of [-1, 1]) {
        const h = new THREE.Mesh(
          bentCone(1.25, 6.5, s * 2.2, -1.2),
          mat('#5a0808', { roughness: 0.35, emissive: '#2a0000' }),
        );
        h.position.set(s * 3.3, 8.6, 2.2);
        h.rotation.z = -s * 0.3;
        h.rotation.x = -0.2;
        solid.add(h);
      }
      fangs(0.9, false);
      break;
    }
    case 'vampire':
      fangs(1.5, false);
      break;
    case 'werewolf': {
      for (const s of [-1, 1]) {
        const ear = new THREE.Group();
        const outer = new THREE.Mesh(new THREE.ConeGeometry(2.6, 6.5, 4), mat('#6e4c2e', { roughness: 0.9 }));
        outer.scale.z = 0.45;
        outer.rotation.y = Math.PI / 4;
        const inner = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4.8, 4), mat('#b07a6e', { roughness: 0.9 }));
        inner.scale.z = 0.3;
        inner.rotation.y = Math.PI / 4;
        inner.position.set(0, -0.4, 0.55);
        ear.add(outer, inner);
        ear.position.set(s * 5.4, 10.4, -1.5);
        ear.rotation.z = -s * 0.4;
        solid.add(ear);
      }
      fangs(1.1, false);
      fangs(0.8, true);
      break;
    }
    case 'witch': {
      const hat = new THREE.Group();
      const black = mat('#1d1226', { roughness: 0.8 });
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(12.5, 12.5, 0.35, 48), black);
      const cone = new THREE.Mesh(bentCone(6.9, 15, look.seed & 1 ? 3.5 : -3.5, -2.5, 32), black);
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(6.55, 6.95, 1.7, 40, 1, true),
        mat('#6b2a8a', { side: THREE.DoubleSide }),
      );
      band.position.y = 1;
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 0.3), mat('#d8b530', { metalness: 0.6 }));
      buckle.position.set(0, 1, 6.85);
      hat.add(brim, cone, band, buckle);
      hat.position.set(0, 9.6, -2.2);
      hat.rotation.x = -0.18;
      hat.rotation.z = look.seed & 2 ? 0.12 : -0.12;
      solid.add(hat);
      break;
    }
    case 'zombie': {
      if (look.marks.includes('knife')) {
        const s = look.seed & 1 ? 1 : -1;
        const knife = new THREE.Group();
        const blade = new THREE.Mesh(
          new THREE.BoxGeometry(1.9, 9, 0.16),
          mat('#cfd3da', { metalness: 0.9, roughness: 0.22 }),
        );
        blade.position.y = 1.5;
        const guard = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 0.8), mat('#555', { metalness: 0.7 }));
        guard.position.y = 6.2;
        const handle = new THREE.Mesh(new THREE.BoxGeometry(1.5, 5, 1.1), mat('#3a2416', { roughness: 0.8 }));
        handle.position.y = 8.9;
        const blood = new THREE.Mesh(
          new THREE.BoxGeometry(1.95, 2.2, 0.2),
          mat('#7a0010', { roughness: 0.3 }),
        );
        blood.position.y = -1.2;
        knife.add(blade, guard, handle, blood);
        knife.position.set(s * 3.2, 10.6, 0.8);
        knife.rotation.z = -s * 0.55;
        knife.rotation.x = 0.15;
        solid.add(knife);
      } else if (look.marks.includes('arrow')) {
        const arrow = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 30, 10), mat('#8a5a2b'));
        shaft.rotation.z = Math.PI / 2;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.95, 2.6, 8), mat('#a9adb5', { metalness: 0.8 }));
        tip.rotation.z = -Math.PI / 2;
        tip.position.x = 16.2;
        arrow.add(shaft, tip);
        for (let k = 0; k < 3; k++) {
          const f = new THREE.Mesh(
            new THREE.PlaneGeometry(4, 1.3),
            mat('#c8302a', { side: THREE.DoubleSide, roughness: 0.9 }),
          );
          f.position.x = -13.5;
          f.rotation.x = (k * Math.PI) / 3;
          f.translateY(0.7);
          arrow.add(f);
        }
        arrow.position.set(0, 4.5, -2.4);
        arrow.rotation.y = 0.12;
        arrow.rotation.z = 0.05;
        solid.add(arrow);
      }
      if (look.marks.includes('bolts'))
        for (const s of [-1, 1]) {
          const b = new THREE.Mesh(
            new THREE.CylinderGeometry(0.75, 0.75, 3.2, 14),
            mat('#8d9299', { metalness: 0.8, roughness: 0.35 }),
          );
          b.rotation.z = Math.PI / 2;
          b.position.set(s * 6.9, -8.2, -3.2);
          const nut = new THREE.Mesh(
            new THREE.CylinderGeometry(1.25, 1.25, 0.8, 6),
            mat('#6d7279', { metalness: 0.8 }),
          );
          nut.rotation.z = Math.PI / 2;
          nut.position.set(s * 8.4, -8.2, -3.2);
          solid.add(b, nut);
        }
      break;
    }
    default:
      break;
  }
  return { solid, front };
}

// ---------------------------------------------------------------- rendering

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec4 vClip;
void main() {
  vUv = uv;
  vClip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vClip;
}`;
const FRAG = /* glsl */ `
uniform sampler2D tint;
uniform sampler2D paint;
uniform sampler2D cam;
uniform vec4 camRect; // where the camera picture lies in clip space: x0, y0, w, h (0..1 of canvas)
uniform float skinLum;
uniform float opacity;
varying vec2 vUv;
varying vec4 vClip;
void main() {
  vec2 s = vClip.xy / vClip.w * 0.5 + 0.5;
  vec2 cuv = vec2((s.x - camRect.x) / camRect.z, (s.y - camRect.y) / camRect.w);
  vec3 c = texture2D(cam, cuv).rgb;
  float lc = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // skin tint: the paint's colour with the real face's brightness (light, pores, wrinkles stay)
  vec4 t = texture2D(tint, vUv);
  float lt = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 tinted = min(vec3(1.0), t.rgb * (lc / max(0.01, lt)) * 1.05);
  vec3 col = mix(c, tinted, t.a);
  // make-up details, shaded by the real face (relative to the mean skin brightness)
  vec4 p = texture2D(paint, vUv);
  float shade = pow(clamp(lc / max(0.02, skinLum), 0.2, 2.0), 1.3);
  col = mix(col, p.rgb * shade, p.a);
  float a = max(t.a, p.a);
  gl_FragColor = vec4(col, a * opacity);
  #include <colorspace_fragment>
}`;

interface Slot {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  pose: THREE.Group;
  occluder: THREE.Mesh;
  props: Map<string, { solid: THREE.Group; front: THREE.Group }>;
}

export class FaceFilter {
  readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 0, -1, -5000, 5000);
  private camTex: THREE.CanvasTexture | null = null;
  private slots: Slot[] = [];
  private paints = new Map<string, { tint: THREE.Texture; detail: THREE.Texture }>();
  failed = false;
  /** Picture size and the extra room above it (for hats and horns). */
  private W = 0;
  private H = 0;
  top = 0;

  constructor() {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
      });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } catch {
      this.failed = true;
    }
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 1.8);
    d.position.set(0.4, 1, 1.2);
    this.scene.add(d);
  }

  private paintFor(look: Look): { tint: THREE.Texture; detail: THREE.Texture } {
    const key = `${look.kind}:${look.seed}:${look.marks.join(',')}`;
    let t = this.paints.get(key);
    if (!t) {
      const pl = paintLook(look);
      const tex = (c: HTMLCanvasElement) => {
        const x = new THREE.CanvasTexture(c);
        x.colorSpace = THREE.SRGBColorSpace;
        x.anisotropy = 4;
        // painted in picture rows (y down) = the mesh's uv
        x.flipY = false;
        return x;
      };
      t = { tint: tex(pl.tint), detail: tex(pl.detail) };
      this.paints.set(key, t);
      if (this.paints.size > 24) {
        const k0 = this.paints.keys().next().value as string;
        const old = this.paints.get(k0);
        old?.tint.dispose();
        old?.detail.dispose();
        this.paints.delete(k0);
      }
    }
    return t;
  }

  private slot(i: number): Slot {
    let s = this.slots[i];
    if (s) return s;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MESH_N * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(MESH_UV, 2));
    geo.setIndex(new THREE.BufferAttribute(MESH_TRIS, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tint: { value: null },
        paint: { value: null },
        cam: { value: null },
        camRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        skinLum: { value: 0.3 },
        opacity: { value: 0.92 },
      },
      // blended, but drawn first with the opaque things so its depth hides what is behind
      transparent: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -2;
    const pose = new THREE.Group();
    pose.matrixAutoUpdate = false;
    // the head without the face: hides the parts of hat, knife and arrow behind / inside it
    const occluder = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 18),
      new THREE.MeshBasicMaterial({ colorWrite: false }),
    );
    occluder.scale.set(7.2, 10.2, 8.6);
    occluder.position.set(0, 1.8, -3.6);
    occluder.renderOrder = -1;
    pose.add(occluder);
    this.scene.add(mesh, pose);
    s = { mesh, pose, occluder, props: new Map() };
    this.slots[i] = s;
    return s;
  }

  /** Renders the faces over a transparent picture of W × (top + H) pixels. */
  render(src: HTMLCanvasElement, faces: FaceIn[], W: number, H: number, top: number): boolean {
    const r = this.renderer;
    if (!r || this.failed) return false;
    if (W !== this.W || H !== this.H || top !== this.top) {
      this.W = W;
      this.H = H;
      this.top = top;
      r.setSize(W, H + top, false);
      this.camera.left = 0;
      this.camera.right = W;
      this.camera.top = top;
      this.camera.bottom = -H;
      this.camera.updateProjectionMatrix();
    }
    if (!this.camTex || this.camTex.image !== src) {
      this.camTex?.dispose();
      this.camTex = new THREE.CanvasTexture(src);
      this.camTex.colorSpace = THREE.SRGBColorSpace;
      this.camTex.minFilter = THREE.LinearFilter;
      this.camTex.generateMipmaps = false;
    }
    this.camTex.needsUpdate = true;
    const camRect = new THREE.Vector4(0, 0, 1, H / (H + top));
    let n = 0;
    for (const f of faces) {
      if (f.look.kind === 'comic' || f.pts.length < 468) continue;
      const s = this.slot(n++);
      const pos = s.mesh.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < 468; i++) {
        const p = f.pts[i]!;
        pos.setXYZ(i, p.x, -p.y, -p.z);
      }
      for (let j = 0; j < MESH_N - 468; j++) {
        const p = extend((i) => f.pts[i]!, j);
        pos.setXYZ(468 + j, p.x, -p.y, -p.z);
      }
      pos.needsUpdate = true;
      s.mesh.geometry.computeBoundingSphere();
      const u = s.mesh.material.uniforms;
      const pt = this.paintFor(f.look);
      u.tint!.value = pt.tint;
      u.paint!.value = pt.detail;
      u.cam!.value = this.camTex;
      (u.camRect!.value as THREE.Vector4).copy(camRect);
      // the shader works in linear light
      u.skinLum!.value = Math.pow(Math.max(0.03, f.lum), 2.2);
      s.mesh.visible = true;
      this.posePose(s, f.pts);
      const key = `${f.look.kind}:${f.look.seed}:${f.look.marks.join(',')}`;
      for (const [k, pr] of s.props) {
        pr.solid.visible = k === key;
        pr.front.visible = k === key;
      }
      if (!s.props.has(key)) {
        const pr = buildProps(f.look);
        pr.front.traverse((o) => {
          o.renderOrder = 2;
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (m) m.depthTest = false;
        });
        s.pose.add(pr.solid, pr.front);
        s.props.set(key, pr);
        if (s.props.size > 6) {
          const [k0, old] = s.props.entries().next().value as [
            string,
            { solid: THREE.Group; front: THREE.Group },
          ];
          s.pose.remove(old.solid, old.front);
          s.props.delete(k0);
        }
      }
      s.pose.visible = true;
    }
    for (let i = n; i < this.slots.length; i++) {
      this.slots[i]!.mesh.visible = false;
      this.slots[i]!.pose.visible = false;
    }
    r.render(this.scene, this.camera);
    return n > 0;
  }

  /** Head pose from the face points: the canonical face space → picture space. */
  private posePose(s: Slot, pts: P3[]): void {
    const P = (i: number) => new THREE.Vector3(pts[i]!.x, -pts[i]!.y, -pts[i]!.z);
    const right = P(263)
      .sub(P(33))
      .add(P(454).sub(P(234)).multiplyScalar(0.5))
      .normalize();
    const upRaw = P(10).sub(P(152));
    const up = upRaw.sub(right.clone().multiplyScalar(upRaw.dot(right))).normalize();
    const fwd = new THREE.Vector3().crossVectors(right, up).normalize();
    const scale = P(263).distanceTo(P(33)) / canon(263).distanceTo(canon(33));
    const rot = new THREE.Matrix4().makeBasis(right, up, fwd);
    const o = new THREE.Vector3();
    const ids = [1, 33, 263, 10, 152, 234, 454, 168];
    for (const i of ids) o.add(P(i).sub(canon(i).applyMatrix4(rot).multiplyScalar(scale)));
    o.multiplyScalar(1 / ids.length);
    s.pose.matrix
      .copy(rot)
      .scale(new THREE.Vector3(scale, scale, scale))
      .setPosition(o);
    s.pose.matrixWorldNeedsUpdate = true;
  }

  dispose(): void {
    for (const t of this.paints.values()) {
      t.tint.dispose();
      t.detail.dispose();
    }
    this.camTex?.dispose();
    this.renderer?.dispose();
  }
}
