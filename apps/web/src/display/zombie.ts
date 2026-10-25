/**
 * Zombie camera: cuts the people out of the camera picture (MediaPipe selfie segmentation),
 * follows their faces in 3D (MediaPipe face landmarks, checked against the person mask so objects
 * do not get faces) and turns each person into a random creature with a real face filter (see
 * faceFilter.ts) – zombie (scars, bolts, a knife or an arrow in the head …), ghost, vampire,
 * skeleton, devil, werewolf, witch or a cartoon with googly eyes – in their own colours, slightly
 * transparent like a ghost. Runs on the projector PCs (live on the wall) and on the phone (preview
 * and ghost photos – photos are only ever taken on the phone).
 */
import type { LiveSprite, StageRenderer } from '@spectrastage/engine';
import type { RtcData } from '@spectrastage/shared';
import type { Connection } from '../lib/connection.ts';
import type * as Mp from '@mediapipe/tasks-vision';
import { FaceFilter, type FaceIn, type Kind, type Look, type Mark, type P3 } from './faceFilter.ts';

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const MAX_W = 720;
/** Extra room above each person (share of their height) for horns, hats, ears … */
const HEADROOM = 0.3;
/** Extra room above the whole picture for the 3D props (share of its height). */
const TOP = 0.35;

type Vision = typeof Mp;
type Segmenter = Mp.ImageSegmenter;
type FaceLm = Mp.FaceLandmarker;
type Pt = { x: number; y: number };
/** How often each creature appears. */
const KINDS: [Kind, number][] = [
  ['zombie', 0.24],
  ['ghost', 0.11],
  ['vampire', 0.11],
  ['skeleton', 0.11],
  ['devil', 0.11],
  ['werewolf', 0.11],
  ['witch', 0.11],
  ['comic', 0.1],
];
interface Person {
  id: number;
  box: { x: number; y: number; w: number; h: number };
  canvas: HTMLCanvasElement;
  seen: number;
  alpha: number;
  label: number;
  /** Smoothed face points (picture pixels), or null without a face. */
  face: P3[] | null;
  lum: number;
  /** Last time a real face was found in this person (objects never get one). */
  faceSeen: number;
  capturedAt: number;
  look: Look;
}

function makeLook(id: number): Look {
  let x = (id * 2654435761) >>> 0 || 1;
  const r = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const all = ['forehead', 'cheek', 'bandage', 'bolts', 'veins', 'spots'] as const;
  const marks: Mark[] = all.filter(() => r() < 0.4);
  if (!marks.length) marks.push(pick(all));
  // a knife or an arrow through the head now and then
  const stuck = r();
  if (stuck < 0.3) marks.unshift('knife');
  else if (stuck < 0.45) marks.unshift('arrow');
  let k = r();
  let kind: Kind = 'zombie';
  for (const [kk, w] of KINDS) {
    if ((k -= w) < 0) {
      kind = kk;
      break;
    }
  }
  const eyes: Look['eyes'] =
    kind === 'vampire'
      ? 'red'
      : kind === 'devil'
        ? pick(['yellow', 'red'] as const)
        : kind === 'werewolf'
          ? 'yellow'
          : kind === 'witch'
            ? pick(['yellow', 'blue', 'milky'] as const)
            : pick(['yellow', 'red', 'milky', 'black', 'blue'] as const);
  return { kind, eyes, marks: marks.slice(0, 3), seed: Math.floor(r() * 1e6) };
}

/** A ghost photo of one person. */
export interface Shot {
  /** Cut out, with the live filter (data URL). */
  image: string;
  /** Where the person stood (0..1 across the picture). */
  u: number;
  /** The plain camera photo of the person (for the image AI). */
  photo: string;
  look: Look;
}

export class ZombieFx {
  private work = document.createElement('canvas');
  private tmp = document.createElement('canvas');
  private seg: Segmenter | null = null;
  private face: FaceLm | null = null;
  private filter: FaceFilter | null = null;
  private frame = 0;
  private people: Person[] = [];
  private nextId = 1;
  private glow = document.createElement('canvas');
  ready = false;
  failed = false;
  private lastProcess = 0;
  private video: HTMLVideoElement | null = null;
  private lastTs = 0;
  private interval = 80;

  async init(): Promise<void> {
    try {
      const vision: Vision = await import('@mediapipe/tasks-vision');
      const files = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const make = async (delegate: 'GPU' | 'CPU') => {
        this.seg = await vision.ImageSegmenter.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/mediapipe/selfie_segmenter.tflite', delegate },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
        // every frame on a sharp crop around each person's head (small faces in a group too)
        this.face = await vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate },
          runningMode: 'IMAGE',
          numFaces: 1,
          minFaceDetectionConfidence: 0.6,
          minFacePresenceConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
      };
      try {
        await make('GPU');
      } catch {
        await make('CPU');
      }
      this.filter = new FaceFilter();
      this.ready = true;
    } catch (e) {
      console.warn('[SpectraStage] zombie camera unavailable', e);
      this.failed = true;
    }
  }

  process(video: HTMLVideoElement, ts: number): void {
    if (!this.seg || video.videoWidth === 0) return;
    this.video = video;
    // MediaPipe needs rising time stamps
    ts = Math.max(ts, this.lastTs + 1);
    this.lastTs = ts;
    // how often a picture gets processed (slow PCs: hold people visible longer between pictures)
    const pn = performance.now();
    if (this.lastProcess) this.interval = this.interval * 0.8 + Math.min(5000, pn - this.lastProcess) * 0.2;
    this.lastProcess = pn;
    const k = Math.min(1, MAX_W / video.videoWidth);
    const W = Math.round(video.videoWidth * k);
    const H = Math.round(video.videoHeight * k);
    for (const c of [this.work, this.tmp]) {
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
    }
    const wg = this.work.getContext('2d', { willReadFrequently: true })!;
    // mirrored, like a mirror: people recognise their own movements
    wg.setTransform(-1, 0, 0, 1, W, 0);
    wg.drawImage(video, 0, 0, W, H);
    wg.setTransform(1, 0, 0, 1, 0, 0);
    let mask: Float32Array | null = null;
    this.seg.segmentForVideo(this.work, ts, (r: Mp.ImageSegmenterResult) => {
      const m = r.confidenceMasks?.[0];
      if (m) mask = m.getAsFloat32Array().slice();
    });
    this.frame++;
    if (!mask) return;
    const m: Float32Array = mask;
    const img = wg.getImageData(0, 0, W, H);
    const d = img.data;
    // every person on their own: connected areas of the mask on a coarse grid
    const C = 4;
    const gw = Math.ceil(W / C);
    const gh = Math.ceil(H / C);
    const lab = new Int32Array(gw * gh).fill(-1);
    const comps: { x0: number; y0: number; x1: number; y1: number; n: number }[] = [];
    const stack: number[] = [];
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        const gi = gy * gw + gx;
        if (lab[gi] !== -1 || m[Math.min(H - 1, gy * C) * W + Math.min(W - 1, gx * C)]! <= 0.6) continue;
        const id = comps.length;
        const comp = { x0: gx, y0: gy, x1: gx, y1: gy, n: 0 };
        comps.push(comp);
        lab[gi] = id;
        stack.push(gi);
        while (stack.length) {
          const c = stack.pop()!;
          const cx = c % gw;
          const cy = (c - cx) / gw;
          comp.n++;
          if (cx < comp.x0) comp.x0 = cx;
          if (cx > comp.x1) comp.x1 = cx;
          if (cy < comp.y0) comp.y0 = cy;
          if (cy > comp.y1) comp.y1 = cy;
          for (const [nx, ny] of [
            [cx + 1, cy],
            [cx - 1, cy],
            [cx, cy + 1],
            [cx, cy - 1],
          ] as const) {
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
            const ni = ny * gw + nx;
            if (lab[ni] !== -1 || m[Math.min(H - 1, ny * C) * W + Math.min(W - 1, nx * C)]! <= 0.6) continue;
            lab[ni] = id;
            stack.push(ni);
          }
        }
      }
    // follow the people from picture to picture (stable ids → stable places on the wall)
    const now = performance.now();
    const found = comps
      .map((c, k) => ({ k, c }))
      .filter(({ c }) => c.n >= gw * gh * 0.004 && (c.y1 - c.y0 + 1) * C >= H * 0.15);
    const used = new Set<Person>();
    const active: Person[] = [];
    for (const { k, c } of found) {
      const pad = (c.y1 - c.y0 + 1) * C * 0.06;
      // a little more room at the sides for ears, horns, an arrow …
      const nb = {
        x: c.x0 * C - pad * 2,
        y: c.y0 * C - pad,
        w: (c.x1 - c.x0 + 1) * C + pad * 4,
        h: (c.y1 - c.y0 + 1) * C + pad * 2,
      };
      const cx = nb.x + nb.w / 2;
      let best: Person | null = null;
      for (const pr of this.people)
        if (!used.has(pr) && Math.abs(pr.box.x + pr.box.w / 2 - cx) < W * 0.25)
          if (!best || Math.abs(pr.box.x + pr.box.w / 2 - cx) < Math.abs(best.box.x + best.box.w / 2 - cx))
            best = pr;
      // lost for a moment (slow recognition, a jump): take the nearest one seen recently instead
      // of making a new ghost that would fade in from transparent
      if (!best)
        for (const pr of this.people)
          if (!used.has(pr) && now - pr.seen < 3000)
            if (!best || Math.abs(pr.box.x + pr.box.w / 2 - cx) < Math.abs(best.box.x + best.box.w / 2 - cx))
              best = pr;
      if (!best) {
        const id = this.nextId++;
        best = {
          id,
          box: nb,
          canvas: document.createElement('canvas'),
          seen: now,
          alpha: 0,
          label: k,
          face: null,
          lum: 0.5,
          faceSeen: 0,
          capturedAt: 0,
          look: makeLook(id + Math.floor(Math.random() * 1e6)),
        };
        this.people.push(best);
      }
      used.add(best);
      const b = best.box;
      best.box = {
        x: b.x + (nb.x - b.x) * 0.25,
        y: b.y + (nb.y - b.y) * 0.25,
        w: b.w + (nb.w - b.w) * 0.25,
        h: b.h + (nb.h - b.h) * 0.25,
      };
      best.seen = now;
      best.label = k;
      active.push(best);
    }
    const byLabel = new Map(active.map((pr) => [pr.label, pr]));
    // faces: only real faces inside a person count (no faces on posters, lamps, chairs)
    const faceOf = new Map<Person, P3[]>();
    const rawFaces = active
      .map(
        (pr) =>
          this.findFace(pr, W, H) ??
          // lost around the last face (a quick move): look at the whole head area again
          (pr.face ? this.findFace({ ...pr, face: null }, W, H) : null),
      )
      .filter((f): f is P3[] => !!f);
    for (const f of rawFaces) {
      if (f.length < 468) continue;
      const inMask = (p: Pt) => {
        const px = Math.round(p.x);
        const py = Math.round(p.y);
        return px >= 0 && py >= 0 && px < W && py < H && m[py * W + px]! > 0.7;
      };
      if ([1, 33, 263, 13, 152, 10].map((i) => f[i]!).filter(inMask).length < 5) continue;
      const n = f[1]!;
      const l = lab[Math.floor(n.y / C) * gw + Math.floor(n.x / C)] ?? -1;
      const pr = byLabel.get(l);
      if (!pr || faceOf.has(pr)) continue;
      const eye = Math.hypot(f[33]!.x - f[263]!.x, f[33]!.y - f[263]!.y);
      if (eye < 6 || eye > pr.box.w * 0.9) continue;
      faceOf.set(pr, f);
    }
    for (const pr of active) {
      const f = faceOf.get(pr);
      if (!f) {
        if (now - pr.faceSeen > 400) pr.face = null;
        continue;
      }
      pr.face = smooth(pr.face, f);
      pr.faceSeen = now;
      // mean skin brightness (for shading the face paint)
      let s = 0;
      let n = 0;
      for (const i of [50, 280, 9, 151, 4, 205, 425]) {
        const p = f[i]!;
        const o =
          (Math.round(Math.min(H - 1, Math.max(0, p.y))) * W +
            Math.round(Math.min(W - 1, Math.max(0, p.x)))) *
          4;
        s += (0.2126 * d[o]! + 0.7152 * d[o + 1]! + 0.0722 * d[o + 2]!) / 255;
        n++;
      }
      pr.lum = pr.lum * 0.7 + (s / n) * 0.3;
    }

    // the people in their own colours, cut out, a little lifted and transparent like a ghost
    const lookOf = (x: number, y: number): Look | undefined => {
      const l = lab[Math.floor(y / C) * gw + Math.floor(x / C)]!;
      return l >= 0 ? byLabel.get(l)?.look : undefined;
    };
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const c = m[i]!;
      // solid person, soft only right at the outline
      const a = c <= 0.3 ? 0 : c >= 0.55 ? 1 : (c - 0.3) / 0.25;
      if (a <= 0) {
        d[p + 3] = 0;
        continue;
      }
      if (lookOf(i % W, (i / W) | 0)?.kind === 'comic') {
        // cartoon zombie skin: a few green levels from the brightness
        const l = (0.3 * d[p]! + 0.59 * d[p + 1]! + 0.11 * d[p + 2]!) / 255;
        const q = Math.min(1, Math.floor(l * 5 + 0.5) / 5 + 0.08);
        d[p] = 52 + 150 * q;
        d[p + 1] = 92 + 160 * q;
        d[p + 2] = 64 + 110 * q;
      } else {
        d[p] = 22 + d[p]! * 0.95;
        d[p + 1] = 22 + d[p + 1]! * 0.95;
        d[p + 2] = 26 + d[p + 2]! * 0.95;
      }
      d[p + 3] = 255 * a * 0.84;
    }
    this.tmp.getContext('2d')!.putImageData(img, 0, 0);
    // shown are people with a face (or clearly a standing person) – no lamps, chairs, posters
    const shown = active.filter(
      (pr) =>
        now - pr.faceSeen < Math.max(4000, this.interval * 8) ||
        (pr.box.h >= H * 0.45 && pr.box.h >= pr.box.w * 1.1),
    );
    // the face filter for all shown faces at once (one WebGL pass)
    const top = Math.round(H * TOP);
    const faces: FaceIn[] = shown
      .filter((pr) => pr.face)
      .map((pr) => ({ pts: pr.face!, look: pr.look, lum: pr.lum }));
    const gl = this.filter?.render(this.work, faces, W, H, top) ? this.filter.canvas : null;
    const t = ts / 1000;
    for (const pr of shown) this.cutOut(pr, H, lab, gw, C, gl, top, t);
    for (const pr of active) if (!shown.includes(pr)) pr.seen = Math.min(pr.seen, now - 1e6);
  }

  /**
   * Ghost photos of everybody in the picture right now (the shutter on the phone): one photo per
   * person – a group of five gives five separate ghosts.
   */
  captureAll(): Shot[] {
    const W = Math.max(1, this.work.width);
    const now = performance.now();
    const cand = this.people.filter(
      (pr) => now - pr.seen < 1500 && pr.canvas.width > 8 && (pr.face || now - pr.faceSeen < 3000),
    );
    cand.sort((a, b) => a.box.x - b.box.x);
    return cand.map((pr) => {
      pr.capturedAt = now;
      return this.shoot(pr, W);
    });
  }

  private faceCanvas = document.createElement('canvas');
  /** The face of one person: on a crop around the last face (or the top of the person). */
  private findFace(pr: Person, W: number, H: number): P3[] | null {
    if (!this.face) return null;
    let x: number;
    let y: number;
    let w: number;
    let h: number;
    const f = pr.face;
    if (f) {
      const xs = f.map((p) => p.x);
      const ys = f.map((p) => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const s = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 2;
      x = cx - s / 2;
      y = cy - s / 2;
      w = h = s;
    } else {
      const b = pr.box;
      x = b.x;
      y = b.y;
      w = b.w;
      h = Math.max(b.h * 0.55, Math.min(b.h, b.w * 1.1));
    }
    x = Math.max(0, x);
    y = Math.max(0, y);
    w = Math.min(W - x, w);
    h = Math.min(H - y, h);
    if (w < 8 || h < 8) return null;
    const k = 256 / Math.max(w, h);
    const fc = this.faceCanvas;
    fc.width = Math.round(w * k);
    fc.height = Math.round(h * k);
    fc.getContext('2d')!.drawImage(this.work, x, y, w, h, 0, 0, fc.width, fc.height);
    try {
      const r = this.face.detect(fc);
      const lm = r.faceLandmarks[0];
      if (!lm) return null;
      return lm.map((p: Mp.NormalizedLandmark) => ({ x: x + p.x * w, y: y + p.y * h, z: p.z * w }));
    } catch {
      return null;
    }
  }

  private shoot(pr: Person, W: number): Shot {
    const src = pr.canvas;
    const k = Math.min(1, 560 / src.height);
    const c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(src.width * k));
    c.height = Math.max(8, Math.round(src.height * k));
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    let url = c.toDataURL('image/webp', 0.85);
    if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
    // the plain photo: the person with some room around, as the camera sees them
    const b = pr.box;
    const H = this.work.height;
    const x0 = Math.max(0, b.x - b.w * 0.1);
    const y0 = Math.max(0, b.y - b.h * 0.12);
    const x1 = Math.min(W, b.x + b.w * 1.1);
    const y1 = Math.min(H, b.y + b.h);
    // in the camera's full resolution (the AI paints better from a sharp photo), mirrored like
    // everything else
    const v = this.video;
    const kv = v && v.videoWidth ? v.videoWidth / W : 1;
    const ph = document.createElement('canvas');
    const sc = Math.min(kv, 1280 / Math.max(1, y1 - y0));
    ph.width = Math.max(8, Math.round((x1 - x0) * sc));
    ph.height = Math.max(8, Math.round((y1 - y0) * sc));
    const pg = ph.getContext('2d')!;
    if (v && v.videoWidth) {
      pg.setTransform(-1, 0, 0, 1, ph.width, 0);
      pg.drawImage(v, (W - x1) * kv, y0 * kv, (x1 - x0) * kv, (y1 - y0) * kv, 0, 0, ph.width, ph.height);
    } else pg.drawImage(this.work, x0, y0, x1 - x0, y1 - y0, 0, 0, ph.width, ph.height);
    return {
      image: url,
      u: (b.x + b.w / 2) / Math.max(1, W),
      photo: ph.toDataURL('image/jpeg', 0.92),
      look: pr.look,
    };
  }

  /** One person as their own sprite: their box, others in it removed, ghost tail, glow. */
  private cutOut(
    pr: Person,
    H: number,
    lab: Int32Array,
    gw: number,
    C: number,
    gl: HTMLCanvasElement | null,
    top: number,
    t: number,
  ): void {
    const box = pr.box;
    const ow = Math.max(8, Math.round(box.w));
    // room above the head for horns, hats, ears, a knife … (also when the head touches the
    // top of the camera picture)
    const head = Math.round(box.h * HEADROOM);
    const oh = Math.max(8, Math.round(box.h)) + head;
    const cv = pr.canvas;
    if (cv.width !== ow || cv.height !== oh) {
      cv.width = ow;
      cv.height = oh;
    }
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, ow, oh);
    g.drawImage(this.tmp, box.x, box.y, box.w, box.h, 0, head, ow, oh - head);
    // remove the neighbours that reach into this box
    const sx = ow / box.w;
    const sy = (oh - head) / box.h;
    const gx0 = Math.max(0, Math.floor(box.x / C));
    const gy0 = Math.max(0, Math.floor(box.y / C));
    const gx1 = Math.min(gw - 1, Math.ceil((box.x + box.w) / C));
    const gy1 = Math.min(Math.ceil(H / C) - 1, Math.ceil((box.y + box.h) / C));
    for (let gy = gy0; gy <= gy1; gy++)
      for (let gx = gx0; gx <= gx1; gx++) {
        const l = lab[gy * gw + gx]!;
        if (l !== -1 && l !== pr.label)
          g.clearRect(
            (gx * C - box.x - 1) * sx,
            head + (gy * C - box.y - 1) * sy,
            (C + 2) * sx,
            (C + 2) * sy,
          );
      }
    // the face filter (and its 3D props above the head)
    if (gl && pr.face && pr.look.kind !== 'comic')
      g.drawImage(gl, box.x, box.y + top - box.h * HEADROOM, box.w, box.h * (1 + HEADROOM), 0, 0, ow, oh);
    if (pr.face) {
      g.save();
      g.setTransform(sx, 0, 0, sy, -box.x * sx, head - box.y * sy);
      if (pr.look.kind === 'comic') drawComic(g, pr.face, pr.id, t);
      else drawEyes(g, pr.face, pr.look, t);
      g.restore();
    }
    // ghost tail: fade out towards the bottom
    g.save();
    g.globalCompositeOperation = 'destination-in';
    const gr = g.createLinearGradient(0, 0, 0, oh);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(0.86, 'rgba(0,0,0,1)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, ow, oh);
    g.restore();
    // ghostly glow around the figure
    const glow = this.glow;
    if (glow.width !== ow || glow.height !== oh) {
      glow.width = ow;
      glow.height = oh;
    }
    const gg = glow.getContext('2d')!;
    gg.clearRect(0, 0, ow, oh);
    gg.drawImage(cv, 0, 0);
    g.save();
    g.globalCompositeOperation = 'destination-over';
    g.filter = `blur(${Math.max(2, Math.round(oh / 45))}px) brightness(1.7)`;
    g.globalAlpha = 0.5;
    g.drawImage(glow, 0, 0);
    g.restore();
  }

  /** The people currently seen (fading in/out), with their horizontal place in the picture. */
  sprites(
    dt: number,
    on: boolean,
    W = this.work.width,
  ): { canvas: HTMLCanvasElement; alpha: number; u: number; id: number }[] {
    const now = performance.now();
    const out: { canvas: HTMLCanvasElement; alpha: number; u: number; id: number }[] = [];
    this.people = this.people.filter((pr) => {
      // a person stays fully visible while the camera sees them (also on a slow PC where the
      // recognition runs only a few times a second); fade in quickly, out gently
      const target = on && now - pr.seen < Math.max(1500, this.interval * 3) ? 1 : 0;
      const rate = target > pr.alpha ? 3 : 1;
      pr.alpha += Math.sign(target - pr.alpha) * Math.min(Math.abs(target - pr.alpha), dt * rate);
      if (pr.alpha <= 0.001 && target === 0) return false;
      out.push({
        canvas: pr.canvas,
        alpha: pr.alpha,
        u: (pr.box.x + pr.box.w / 2) / Math.max(1, W),
        id: pr.id,
      });
      return true;
    });
    return out;
  }

  dispose(): void {
    this.seg?.close();
    this.face?.close();
    this.filter?.dispose();
  }
}

/**
 * Follows the face smoothly: calm when it stands still (no jitter), immediate when it moves
 * (no lagging behind) – the speed decides how much of the new position is taken.
 */
function smooth(prev: P3[] | null, cur: P3[]): P3[] {
  if (!prev || prev.length !== cur.length) return cur.map((p) => ({ ...p }));
  const size = Math.max(1, Math.hypot(cur[33]!.x - cur[263]!.x, cur[33]!.y - cur[263]!.y));
  let move = 0;
  for (const i of [1, 33, 263, 152, 10]) move += Math.hypot(cur[i]!.x - prev[i]!.x, cur[i]!.y - prev[i]!.y);
  const v = move / 5 / size;
  const a = Math.min(1, 0.35 + v * 6);
  return cur.map((p, i) => {
    const q = prev[i]!;
    return { x: q.x + (p.x - q.x) * a, y: q.y + (p.y - q.y) * a, z: q.z + (p.z - q.z) * a };
  });
}

/** Glowing eyes (the irises of the real eyes light up). */
function drawEyes(g: CanvasRenderingContext2D, f: P3[], look: Look, t: number): void {
  if (f.length < 478 || look.kind === 'ghost' || look.kind === 'skeleton') return;
  const ew =
    (Math.hypot(f[33]!.x - f[133]!.x, f[33]!.y - f[133]!.y) +
      Math.hypot(f[362]!.x - f[263]!.x, f[362]!.y - f[263]!.y)) /
    2;
  const pulse = 0.85 + 0.15 * Math.sin(t * 2.4 + look.seed);
  for (const i of [468, 473]) {
    const c = f[i]!;
    const r = ew * 0.22;
    if (look.eyes === 'milky' || look.eyes === 'black') {
      g.fillStyle = look.eyes === 'milky' ? 'rgba(232,238,228,0.85)' : 'rgba(5,5,10,0.9)';
      g.beginPath();
      g.arc(c.x, c.y, r, 0, Math.PI * 2);
      g.fill();
      continue;
    }
    const col = look.eyes === 'yellow' ? '235,255,90' : look.eyes === 'red' ? '255,50,30' : '90,200,255';
    g.save();
    g.globalCompositeOperation = 'screen';
    const gr = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 2.2);
    gr.addColorStop(0, `rgba(${col},${0.95 * pulse})`);
    gr.addColorStop(0.45, `rgba(${col},${0.4 * pulse})`);
    gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(c.x, c.y, r * 2.2, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

/** Cartoon: googly eyes, crooked teeth, a stitched scar. */
function drawComic(g: CanvasRenderingContext2D, f: P3[], n: number, t: number): void {
  const avg = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const eyes = [avg(f[33]!, f[133]!), avg(f[362]!, f[263]!)];
  const ew = (dist(f[33]!, f[133]!) + dist(f[362]!, f[263]!)) / 2;
  for (const e of eyes) {
    const gr = g.createRadialGradient(e.x, e.y, ew * 0.3, e.x, e.y, ew * 1.0);
    gr.addColorStop(0, 'rgba(40,0,50,0.85)');
    gr.addColorStop(1, 'rgba(40,0,50,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(e.x, e.y, ew * 1.0, 0, Math.PI * 2);
    g.fill();
  }
  eyes.forEach((e, i) => {
    const r = ew * (i === 0 ? 0.62 : 0.5);
    g.fillStyle = '#fbfff2';
    g.strokeStyle = '#1a2a1a';
    g.lineWidth = Math.max(1, ew * 0.08);
    g.beginPath();
    g.arc(e.x, e.y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    const ox = Math.sin(t * 3.1 + i * 1.7 + n) * r * 0.35;
    const oy = r * 0.25 + Math.cos(t * 2.3 + i) * r * 0.2;
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(e.x + ox, e.y + oy, r * 0.42, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.beginPath();
    g.arc(e.x + ox - r * 0.12, e.y + oy - r * 0.14, r * 0.1, 0, Math.PI * 2);
    g.fill();
  });
  const l = f[61]!;
  const rr = f[291]!;
  const up = f[13]!;
  const mw = dist(l, rr);
  g.fillStyle = '#f4f0c8';
  g.strokeStyle = '#3a3a20';
  g.lineWidth = Math.max(1, mw * 0.02);
  for (let k = 0; k < 4; k++) {
    const u = 0.25 + k * 0.17;
    const x = l.x + (rr.x - l.x) * u;
    const y = l.y + (rr.y - l.y) * u + (up.y - (l.y + rr.y) / 2) * Math.sin(u * Math.PI);
    const tw = mw * 0.11;
    const th = mw * (k % 2 ? 0.16 : 0.22);
    g.save();
    g.translate(x, y);
    g.rotate((k % 2 ? 0.15 : -0.12) * (n % 2 ? -1 : 1));
    g.fillRect(-tw / 2, 0, tw, th);
    g.strokeRect(-tw / 2, 0, tw, th);
    g.restore();
  }
  const a = f[67]!;
  const b = f[10]!;
  g.strokeStyle = '#5a1a2a';
  g.lineWidth = Math.max(1.5, ew * 0.12);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(a.x, a.y + ew * 0.3);
  g.lineTo(b.x, b.y + ew * 0.5);
  g.stroke();
}

/** Receives the zombie camera on a projector PC and feeds the renderer (live only, no photos). */
export class ZombieReceiver {
  private pc: RTCPeerConnection | null = null;
  private peer: string | null = null;
  private video = document.createElement('video');
  private fx: ZombieFx | null = null;
  private timer = 0;
  private live = false;
  private lastFrame = 0;
  private off: () => void;

  constructor(
    private conn: Connection,
    private renderer: StageRenderer,
  ) {
    this.video.muted = true;
    this.video.playsInline = true;
    this.off = conn.onRtc((from, data) => void this.onRtc(from, data));
    renderer.setLiveSprite(() => this.sprite());
  }

  private sprite(): LiveSprite[] {
    const now = performance.now();
    const dt = Math.min(500, now - (this.lastFrame || now)) / 1000;
    this.lastFrame = now;
    if (!this.fx?.ready) return [];
    return this.fx.sprites(dt, this.live);
  }

  private async onRtc(from: string, data: RtcData): Promise<void> {
    if (data.kind === 'offer' && data.sdp) {
      this.close();
      const pc = new RTCPeerConnection(ICE);
      this.pc = pc;
      this.peer = from;
      pc.onicecandidate = (e) =>
        this.conn.sendRtc(from, { kind: 'ice', candidate: (e.candidate?.toJSON() ?? null) as never });
      pc.ontrack = (e) => {
        this.video.srcObject = e.streams[0] ?? new MediaStream([e.track]);
        void this.video.play().catch(() => {});
        this.live = true;
        void this.ensureFx();
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.live = false;
      };
      await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.conn.sendRtc(from, { kind: 'answer', sdp: answer.sdp ?? '' });
    } else if (from === this.peer && this.pc) {
      if (data.kind === 'ice' && data.candidate)
        await this.pc.addIceCandidate(data.candidate).catch(() => {});
      if (data.kind === 'bye') this.close();
    }
  }

  private async ensureFx(): Promise<void> {
    if (!this.fx) {
      this.fx = new ZombieFx();
      await this.fx.init();
    }
    if (this.timer || this.fx.failed) return;
    // ~15 pictures per second are plenty for drifting ghosts and keep the GPU free for the show
    this.timer = window.setInterval(() => {
      if (!this.live) return;
      try {
        this.fx?.process(this.video, performance.now());
      } catch (e) {
        console.warn('[SpectraStage] zombie frame', e);
      }
    }, 66);
  }

  private close(): void {
    this.live = false;
    this.pc?.close();
    this.pc = null;
    this.peer = null;
  }

  dispose(): void {
    this.close();
    window.clearInterval(this.timer);
    this.off();
    this.renderer.setLiveSprite(null);
    this.fx?.dispose();
  }
}
