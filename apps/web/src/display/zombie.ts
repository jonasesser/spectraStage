/**
 * Zombie camera on the projector PC: receives the phone's camera (WebRTC), cuts the people out
 * (MediaPipe selfie segmentation), finds their faces (MediaPipe face landmarks, checked against
 * the person mask so objects do not get faces) and turns each person into a random creature –
 * zombie (scars, bolts, a knife in the head …), ghost, vampire, skeleton, devil, werewolf, witch
 * or a cartoon with googly eyes – slightly transparent like a ghost. When a
 * face is seen well for a moment, a ghost photo is taken: it is saved with the show and flies
 * around the room (see the renderer); saved ghosts can be released again any time.
 */
import type { LiveSprite, StageRenderer } from '@spectrastage/engine';
import type { RtcData } from '@spectrastage/shared';
import type { Connection } from '../lib/connection.ts';
import type * as Mp from '@mediapipe/tasks-vision';

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const MAX_W = 640;
/** Extra room above each person (share of their height) for horns, hats, ears … */
const HEADROOM = 0.3;

type Vision = typeof Mp;
type Segmenter = Mp.ImageSegmenter;
type FaceLm = Mp.FaceLandmarker;
type Pt = { x: number; y: number };
type Kind = 'zombie' | 'ghost' | 'vampire' | 'skeleton' | 'devil' | 'werewolf' | 'witch' | 'comic';
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
/** Skin per creature (zombies pick one of SKINS). */
const KIND_SKIN: Partial<Record<Kind, [number, number, number, number]>> = {
  ghost: [0.92, 1.0, 1.12, 46],
  vampire: [1.0, 0.95, 1.02, 30],
  skeleton: [1.0, 1.0, 0.97, 40],
  devil: [1.3, 0.66, 0.6, 12],
  werewolf: [1.06, 0.9, 0.74, 6],
  witch: [0.78, 1.1, 0.72, 10],
};
/** Random creature look of one person. */
interface Variant {
  kind: Kind;
  /** Skin colour: multipliers r, g, b and a lift. */
  skin: [number, number, number, number];
  eyes: 'yellow' | 'red' | 'milky' | 'black' | 'blue';
  mouth: 'dark' | 'stitched' | 'drool' | 'teeth';
  marks: ('forehead' | 'cheek' | 'bandage' | 'bolts' | 'veins' | 'spots' | 'knife' | 'arrow')[];
  /** Cartoon look with googly eyes instead of make-up. */
  comic: boolean;
  seed: number;
}
interface Person {
  id: number;
  box: { x: number; y: number; w: number; h: number };
  canvas: HTMLCanvasElement;
  seen: number;
  alpha: number;
  label: number;
  faces: Pt[][];
  /** Last time a real face was found in this person (objects never get one). */
  faceSeen: number;
  /** Since when the face has been seen well (frontal, big enough) – for the ghost photo. */
  goodSince: number;
  capturedAt: number;
  variant: Variant;
}

const SKINS: [number, number, number, number][] = [
  [0.84, 1.02, 0.84, 14], // zombie green
  [0.86, 0.92, 1.0, 10], // grey-blue ghoul
  [0.96, 0.82, 1.0, 12], // purple
  [1.0, 1.0, 0.98, 30], // pale white
  [0.9, 1.0, 0.78, 8], // rotten olive
];
function makeVariant(id: number): Variant {
  let x = (id * 2654435761) >>> 0;
  const r = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const all = ['forehead', 'cheek', 'bandage', 'bolts', 'veins', 'spots'] as const;
  const marks: Variant['marks'] = all.filter(() => r() < 0.4);
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
  const eyes: Variant['eyes'] =
    kind === 'vampire'
      ? 'red'
      : kind === 'devil'
        ? pick(['yellow', 'red'] as const)
        : kind === 'werewolf'
          ? 'yellow'
          : kind === 'witch'
            ? pick(['yellow', 'blue', 'milky'] as const)
            : pick(['yellow', 'red', 'milky', 'black', 'blue'] as const);
  return {
    kind,
    skin: KIND_SKIN[kind] ?? pick(SKINS),
    eyes,
    mouth: pick(['dark', 'stitched', 'drool', 'teeth'] as const),
    marks: marks.slice(0, 3),
    comic: kind === 'comic',
    seed: Math.floor(r() * 1e6),
  };
}

export class ZombieFx {
  private work = document.createElement('canvas');
  private tmp = document.createElement('canvas');
  private seg: Segmenter | null = null;
  private face: FaceLm | null = null;
  private faces: { f: Pt[]; v: Variant }[] = [];
  private frame = 0;
  private people: Person[] = [];
  private nextId = 1;
  private glow = document.createElement('canvas');
  ready = false;
  failed = false;
  /** Called with a ghost photo (data URL) and where the person stood (0..1). */
  onCapture: ((image: string, u: number) => void) | null = null;
  private lastCapture = 0;
  private lastProcess = 0;
  private interval = 80;
  private lab: Int32Array | null = null;
  private labPerson = new Map<number, Person>();

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
        this.face = await vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate },
          runningMode: 'IMAGE',
          numFaces: 2,
          minFaceDetectionConfidence: 0.6,
          minFacePresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });
      };
      try {
        await make('GPU');
      } catch {
        await make('CPU');
      }
      this.ready = true;
    } catch (e) {
      console.warn('[SpectraStage] zombie camera unavailable', e);
      this.failed = true;
    }
  }

  process(video: HTMLVideoElement, ts: number): void {
    if (!this.seg || video.videoWidth === 0) return;
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
      // a little more room at the sides for ears, horns, fur, an arrow …
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
          faces: [],
          faceSeen: 0,
          goodSince: 0,
          capturedAt: 0,
          variant: makeVariant(id + Math.floor(Math.random() * 1e6)),
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
    this.labPerson = new Map(active.map((pr) => [pr.label, pr]));
    // faces per person (on their head area); only real faces inside the person count
    for (const pr of active) if ((this.frame + pr.id) % 2 === 0) pr.faces = this.findFaces(pr, m, W);
    for (const pr of active) if (pr.faces.length) pr.faceSeen = now;

    // zombie colours for the whole picture, each person in their own skin colour
    const variantOf = (x: number, y: number): Variant | undefined => {
      void SKINS;
      const l = lab[Math.floor(y / C) * gw + Math.floor(x / C)]!;
      return l >= 0 ? this.labPerson.get(l)?.variant : undefined;
    };
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const c = m[i]!;
      // solid person, soft only right at the outline
      const a = c <= 0.3 ? 0 : c >= 0.55 ? 1 : (c - 0.3) / 0.25;
      if (a <= 0) {
        d[p + 3] = 0;
        continue;
      }
      const v = variantOf(i % W, (i / W) | 0);
      if (v?.comic) {
        // cartoon zombie skin: a few green levels from the brightness
        const l = (0.3 * d[p]! + 0.59 * d[p + 1]! + 0.11 * d[p + 2]!) / 255;
        const q = Math.min(1, Math.floor(l * 5 + 0.5) / 5 + 0.08);
        d[p] = 52 + 150 * q;
        d[p + 1] = 92 + 160 * q;
        d[p + 2] = 64 + 110 * q;
      } else {
        // real colours (recognisable), lifted a little so the ghost glows on the dark scene
        d[p] = 22 + d[p]! * 0.95;
        d[p + 1] = 22 + d[p + 1]! * 0.95;
        d[p + 2] = 26 + d[p + 2]! * 0.95;
      }
      // a little transparent, like a ghost
      d[p + 3] = 255 * a * 0.84;
    }
    const tg = this.tmp.getContext('2d')!;
    tg.putImageData(img, 0, 0);
    this.faces = active.flatMap((pr) => pr.faces.map((f) => ({ f, v: pr.variant })));
    // shown are people with a face (or clearly a standing person) – no lamps, chairs, posters
    const shown = active.filter(
      (pr) =>
        now - pr.faceSeen < Math.max(4000, this.interval * 8) ||
        (pr.box.h >= H * 0.45 && pr.box.h >= pr.box.w * 1.1),
    );
    for (const pr of shown) this.cutOut(pr, H, lab, gw, C, ts / 1000);
    for (const pr of active) if (!shown.includes(pr)) pr.seen = Math.min(pr.seen, now - 1e6);
    for (const pr of shown) this.maybeCapture(pr, now, W);
  }

  /** Ghost photo when a face has been seen well for a moment (once a minute per person). */
  private maybeCapture(pr: Person, now: number, W: number): void {
    const f = pr.faces[0];
    const good =
      !!f &&
      f.length >= 468 &&
      this.frontal(f) &&
      Math.hypot(f[33]!.x - f[263]!.x, f[33]!.y - f[263]!.y) > 18;
    if (!good) {
      pr.goodSince = 0;
      return;
    }
    if (!pr.goodSince) pr.goodSince = now;
    if (
      !this.onCapture ||
      now - pr.goodSince < 1200 ||
      now - pr.capturedAt < 60_000 ||
      now - this.lastCapture < 20_000
    )
      return;
    pr.capturedAt = now;
    this.lastCapture = now;
    this.shoot(pr, W);
  }

  /**
   * Ghost photo right now (a tap on the phone): of the person nearest to u (0..1 across the
   * camera picture, as shown in this effect) – or the one with the best face.
   */
  snap(u?: number): boolean {
    const W = Math.max(1, this.work.width);
    const now = performance.now();
    const cand = this.people.filter((pr) => now - pr.seen < 2000 && pr.canvas.width > 8);
    if (!cand.length || !this.onCapture) return false;
    const score = (pr: Person) =>
      u === undefined
        ? -(pr.faces.length ? 1 : 0) * 10 - pr.box.h / W
        : Math.abs((pr.box.x + pr.box.w / 2) / W - u);
    const pr = cand.sort((a, b) => score(a) - score(b))[0]!;
    pr.capturedAt = now;
    this.lastCapture = now;
    this.shoot(pr, W);
    return true;
  }

  private shoot(pr: Person, W: number): void {
    const src = pr.canvas;
    const k = Math.min(1, 480 / src.height);
    const c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(src.width * k));
    c.height = Math.max(8, Math.round(src.height * k));
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    let url = c.toDataURL('image/webp', 0.82);
    if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
    this.onCapture?.(url, (pr.box.x + pr.box.w / 2) / Math.max(1, W));
  }

  /** Face looks into the camera: nose roughly between the eyes. */
  private frontal(f: Pt[]): boolean {
    const l = Math.abs(f[1]!.x - f[33]!.x);
    const r = Math.abs(f[263]!.x - f[1]!.x);
    const q = l / Math.max(1, r);
    return q > 0.55 && q < 1.8;
  }

  private faceCanvas = document.createElement('canvas');
  private findFaces(pr: Person, m: Float32Array, W: number): Pt[][] {
    if (!this.face) return [];
    const b = pr.box;
    const x = Math.max(0, b.x);
    const y = Math.max(0, b.y);
    const w = Math.min(this.work.width - x, b.w);
    const h = Math.min(this.work.height - y, Math.max(b.h * 0.55, Math.min(b.h, b.w * 1.1)));
    if (w < 8 || h < 8) return [];
    const k = Math.min(1, 320 / Math.max(w, h)) * Math.max(1, 160 / Math.max(w, h));
    const fc = this.faceCanvas;
    fc.width = Math.round(w * k);
    fc.height = Math.round(h * k);
    fc.getContext('2d')!.drawImage(this.work, x, y, w, h, 0, 0, fc.width, fc.height);
    try {
      const r = this.face.detect(fc);
      const H = this.work.height;
      return r.faceLandmarks
        .map((f: Mp.NormalizedLandmark[]) => f.map((p) => ({ x: x + p.x * w, y: y + p.y * h })))
        .filter((f: Pt[]) => {
          // a real face sits inside the person (mask), in the upper part, with a sensible size
          if (f.length < 468) return false;
          const inMask = (p: Pt) => {
            const px = Math.round(p.x);
            const py = Math.round(p.y);
            return px >= 0 && py >= 0 && px < W && py < H && m[py * W + px]! > 0.7;
          };
          const pts = [1, 33, 263, 13, 152, 10].map((i) => f[i]!);
          if (pts.filter(inMask).length < 5) return false;
          const eye = Math.hypot(f[33]!.x - f[263]!.x, f[33]!.y - f[263]!.y);
          if (eye < 8 || eye > pr.box.w * 0.9) return false;
          return f[1]!.y < pr.box.y + pr.box.h * 0.75;
        });
    } catch {
      return pr.faces;
    }
  }

  /** One person as their own sprite: their box, others in it removed, ghost tail, glow. */
  private cutOut(pr: Person, H: number, lab: Int32Array, gw: number, C: number, t: number): void {
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
    // the creature: make-up and features on this person's face
    const all = this.faces;
    this.faces = pr.faces.map((f) => ({ f, v: pr.variant }));
    g.save();
    g.setTransform(sx, 0, 0, sy, -box.x * sx, head - box.y * sy);
    this.drawFaces(g, t);
    g.restore();
    this.faces = all;
    // ghost tail: fade out towards the bottom
    g.save();
    g.globalCompositeOperation = 'destination-in';
    const gr = g.createLinearGradient(0, 0, 0, oh);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(0.84, 'rgba(0,0,0,1)');
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
    g.globalAlpha = 0.55;
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

  private drawFaces(g: CanvasRenderingContext2D, t: number): void {
    // every person has their own look: a creature in make-up or a cartoon with googly eyes
    this.drawMakeup(g, t);
    for (const { f, v } of this.faces) if (!v.comic && f.length >= 468) drawCreature(g, f, v, t);
    const avg = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    this.faces.forEach(({ f, v }, n) => {
      if (!v.comic || f.length < 400) return;
      const eyes = [avg(f[33]!, f[133]!), avg(f[362]!, f[263]!)];
      const ew = (dist(f[33]!, f[133]!) + dist(f[362]!, f[263]!)) / 2;
      // dark rings
      for (const e of eyes) {
        const gr = g.createRadialGradient(e.x, e.y, ew * 0.3, e.x, e.y, ew * 1.0);
        gr.addColorStop(0, 'rgba(40,0,50,0.85)');
        gr.addColorStop(1, 'rgba(40,0,50,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(e.x, e.y, ew * 1.0, 0, Math.PI * 2);
        g.fill();
      }
      // googly eyes (pupils wobble)
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
      // crooked teeth along the upper lip
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
      // stitched scar on the forehead
      const a = f[67]!;
      const b = f[10]!;
      g.strokeStyle = '#5a1a2a';
      g.lineWidth = Math.max(1.5, ew * 0.12);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(a.x, a.y + ew * 0.3);
      g.lineTo(b.x, b.y + ew * 0.5);
      g.stroke();
      g.lineWidth = Math.max(1, ew * 0.07);
      for (let k = 1; k <= 4; k++) {
        const u = k / 5;
        const x = a.x + (b.x - a.x) * u;
        const y = a.y + ew * 0.3 + (b.y + ew * 0.2 - a.y) * u;
        g.beginPath();
        g.moveTo(x - ew * 0.12, y - ew * 0.22);
        g.lineTo(x + ew * 0.12, y + ew * 0.22);
        g.stroke();
      }
    });
  }

  /**
   * Zombie make-up on the real face (stays recognisable), different for every person: sunken
   * eye sockets and eyes (glowing yellow/red/blue, milky or black), mouth (dark, stitched,
   * drooling or rotten teeth) and marks (forehead stitches, cheek cut, bandage, neck bolts, veins,
   * rot spots).
   */
  private drawMakeup(g: CanvasRenderingContext2D, t: number): void {
    const avg = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const lerp = (a: Pt, b: Pt, u: number): Pt => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    for (const { f, v } of this.faces) {
      if (v.comic || f.length < 468) continue;
      const eyes = [avg(f[33]!, f[133]!), avg(f[362]!, f[263]!)];
      const ew = (dist(f[33]!, f[133]!) + dist(f[362]!, f[263]!)) / 2;
      const own = v.kind === 'ghost' || v.kind === 'skeleton';
      const zombie = v.kind === 'zombie';
      g.save();
      g.lineCap = 'round';
      // sunken eye sockets (darken, the eye itself stays visible)
      g.globalCompositeOperation = 'multiply';
      for (const e of own ? [] : eyes) {
        const gr = g.createRadialGradient(e.x, e.y + ew * 0.1, ew * 0.25, e.x, e.y + ew * 0.1, ew * 1.05);
        gr.addColorStop(0, 'rgba(70,40,90,0.9)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(e.x, e.y + ew * 0.1, ew * 1.05, 0, Math.PI * 2);
        g.fill();
      }
      // mouth
      const lips = [61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91];
      g.fillStyle = !zombie
        ? 'rgba(70,20,50,0.45)'
        : v.mouth === 'dark'
          ? 'rgba(40,20,45,0.7)'
          : 'rgba(60,30,60,0.5)';
      g.beginPath();
      lips.forEach((i, k) => (k ? g.lineTo(f[i]!.x, f[i]!.y) : g.moveTo(f[i]!.x, f[i]!.y)));
      g.closePath();
      g.fill();
      // rot spots
      if (zombie && v.marks.includes('spots')) {
        for (let k = 0; k < 5; k++) {
          const a = f[[50, 280, 205, 425, 108][k]!]!;
          const r = ew * (0.12 + ((v.seed >> k) & 3) * 0.04);
          const gr = g.createRadialGradient(a.x, a.y, 0, a.x, a.y, r);
          gr.addColorStop(0, 'rgba(80,90,40,0.8)');
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr;
          g.beginPath();
          g.arc(a.x, a.y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();
      g.save();
      g.lineCap = 'round';
      // eyes
      if (f.length >= 478 && !own) {
        for (const i of [468, 473]) {
          const c = f[i]!;
          const r = ew * 0.2;
          if (v.eyes === 'milky' || v.eyes === 'black') {
            g.globalCompositeOperation = 'source-over';
            g.fillStyle = v.eyes === 'milky' ? 'rgba(235,240,230,0.85)' : 'rgba(5,5,10,0.9)';
            g.beginPath();
            g.arc(c.x, c.y, r * 1.05, 0, Math.PI * 2);
            g.fill();
          } else {
            const col = v.eyes === 'yellow' ? '230,255,90' : v.eyes === 'red' ? '255,60,40' : '90,200,255';
            g.globalCompositeOperation = 'screen';
            const gr = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 1.9);
            gr.addColorStop(0, `rgba(${col},0.85)`);
            gr.addColorStop(0.5, `rgba(${col},0.35)`);
            gr.addColorStop(1, `rgba(${col},0)`);
            g.fillStyle = gr;
            g.beginPath();
            g.arc(c.x, c.y, r * 1.9, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
      g.globalCompositeOperation = 'source-over';
      const mL = f[61]!;
      const mR = f[291]!;
      const mw = dist(mL, mR);
      if (!zombie) {
        // the other creatures bring their own mouths and marks (drawCreature)
      } else if (v.mouth === 'stitched') {
        g.strokeStyle = 'rgba(30,15,20,0.9)';
        g.lineWidth = Math.max(1, ew * 0.06);
        g.beginPath();
        g.moveTo(mL.x, mL.y);
        g.lineTo(mR.x, mR.y);
        g.stroke();
        for (let k = 1; k <= 5; k++) {
          const p = lerp(mL, mR, k / 6);
          g.beginPath();
          g.moveTo(p.x, p.y - mw * 0.1);
          g.lineTo(p.x, p.y + mw * 0.1);
          g.stroke();
        }
      } else if (v.mouth === 'drool') {
        const p = lerp(mL, mR, 0.3);
        const len = mw * (0.35 + 0.1 * Math.sin(t * 1.3));
        const gr = g.createLinearGradient(p.x, p.y, p.x, p.y + len);
        gr.addColorStop(0, 'rgba(170,230,120,0.85)');
        gr.addColorStop(1, 'rgba(170,230,120,0)');
        g.strokeStyle = gr;
        g.lineWidth = Math.max(1.5, mw * 0.07);
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.quadraticCurveTo(p.x - mw * 0.05, p.y + len * 0.5, p.x + mw * 0.02, p.y + len);
        g.stroke();
      } else if (v.mouth === 'teeth') {
        const up = f[13]!;
        g.fillStyle = 'rgba(200,190,120,0.9)';
        g.strokeStyle = 'rgba(60,50,20,0.8)';
        g.lineWidth = Math.max(1, mw * 0.02);
        for (let k = 0; k < 4; k++) {
          if (((v.seed >> k) & 3) === 0) continue; // missing tooth
          const u = 0.25 + k * 0.17;
          const x = mL.x + (mR.x - mL.x) * u;
          const y = mL.y + (mR.y - mL.y) * u + (up.y - (mL.y + mR.y) / 2) * Math.sin(u * Math.PI);
          const tw = mw * 0.1;
          const th = mw * (k % 2 ? 0.13 : 0.18);
          g.save();
          g.translate(x, y);
          g.rotate(k % 2 ? 0.12 : -0.1);
          g.fillRect(-tw / 2, 0, tw, th);
          g.strokeRect(-tw / 2, 0, tw, th);
          g.restore();
        }
      }
      // veins at the temples
      if (zombie && v.marks.includes('veins')) {
        g.strokeStyle = 'rgba(30,70,40,0.6)';
        g.lineWidth = Math.max(1, ew * 0.05);
        for (const [a, b] of [
          [33, 127],
          [263, 356],
        ] as const) {
          const A = f[a]!;
          const B = f[b]!;
          g.beginPath();
          g.moveTo(A.x + (B.x - A.x) * 0.3, A.y);
          for (let k = 1; k <= 4; k++) {
            const u = 0.3 + k * 0.17;
            g.lineTo(
              A.x + (B.x - A.x) * u + (k % 2 ? 1 : -1) * ew * 0.08,
              A.y + (B.y - A.y) * u - ew * 0.25 * k * 0.3,
            );
          }
          g.stroke();
        }
      }
      const stitches = (a: Pt, b: Pt, n: number) => {
        g.strokeStyle = 'rgba(110,30,45,0.85)';
        g.lineWidth = Math.max(1.5, ew * 0.09);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
        g.strokeStyle = 'rgba(30,20,20,0.9)';
        g.lineWidth = Math.max(1, ew * 0.05);
        const nx = -(b.y - a.y) / Math.max(1, dist(a, b));
        const ny = (b.x - a.x) / Math.max(1, dist(a, b));
        for (let k = 1; k <= n; k++) {
          const p = lerp(a, b, k / (n + 1));
          g.beginPath();
          g.moveTo(p.x - nx * ew * 0.18, p.y - ny * ew * 0.18);
          g.lineTo(p.x + nx * ew * 0.18, p.y + ny * ew * 0.18);
          g.stroke();
        }
      };
      if (zombie && v.marks.includes('forehead')) {
        const s0 = f[67]!;
        const s1 = f[10]!;
        stitches(
          { x: s0.x + (s1.x - s0.x) * 0.2, y: s0.y + ew * 0.35 },
          { x: s0.x + (s1.x - s0.x) * 0.85, y: s1.y + ew * 0.55 },
          3,
        );
      }
      if (zombie && v.marks.includes('cheek')) {
        const a = f[(v.seed & 1) === 0 ? 116 : 345]!;
        const b = f[(v.seed & 1) === 0 ? 205 : 425]!;
        g.strokeStyle = 'rgba(120,20,30,0.85)';
        g.lineWidth = Math.max(1.5, ew * 0.08);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
        g.strokeStyle = 'rgba(200,40,40,0.5)';
        g.lineWidth = Math.max(1, ew * 0.04);
        g.beginPath();
        g.moveTo(a.x + ew * 0.05, a.y);
        g.lineTo(b.x + ew * 0.05, b.y);
        g.stroke();
      }
      if (zombie && v.marks.includes('bandage')) {
        // a plaster across the forehead
        const c = lerp(f[10]!, f[151]!, 0.6);
        const ang = Math.atan2(f[263]!.y - f[33]!.y, f[263]!.x - f[33]!.x) + (v.seed & 2 ? 0.5 : -0.5);
        g.save();
        g.translate(c.x, c.y);
        g.rotate(ang);
        g.fillStyle = 'rgba(225,205,170,0.92)';
        g.fillRect(-ew * 0.9, -ew * 0.22, ew * 1.8, ew * 0.44);
        g.fillStyle = 'rgba(190,160,130,0.9)';
        g.fillRect(-ew * 0.3, -ew * 0.22, ew * 0.6, ew * 0.44);
        g.fillStyle = 'rgba(140,30,30,0.6)';
        g.beginPath();
        g.arc(ew * 0.05, 0, ew * 0.12, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      if (zombie && v.marks.includes('bolts')) {
        // Frankenstein bolts at the neck, below the jaw
        for (const i of [172, 397]) {
          const p = f[i]!;
          const side = i === 172 ? -1 : 1;
          g.fillStyle = 'rgba(120,125,130,0.95)';
          g.strokeStyle = 'rgba(40,40,45,0.9)';
          g.lineWidth = Math.max(1, ew * 0.04);
          g.fillRect(p.x + side * ew * 0.1 - (side < 0 ? ew * 0.5 : 0), p.y + ew * 0.3, ew * 0.5, ew * 0.22);
          g.strokeRect(
            p.x + side * ew * 0.1 - (side < 0 ? ew * 0.5 : 0),
            p.y + ew * 0.3,
            ew * 0.5,
            ew * 0.22,
          );
        }
      }
      g.restore();
    }
  }

  dispose(): void {
    this.seg?.close();
    this.face?.close();
  }
}

/** Receives the zombie camera on a projector PC and feeds the renderer. */
export class ZombieReceiver {
  private pc: RTCPeerConnection | null = null;
  private peer: string | null = null;
  private video = document.createElement('video');
  private fx: ZombieFx | null = null;
  private timer = 0;
  private live = false;
  private lastFrame = 0;
  /** This PC takes the ghost photos (the phone picks one projector PC for that). */
  private capture = false;
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
    const sp = this.fx.sprites(dt, this.live);
    return sp;
  }

  private async onRtc(from: string, data: RtcData): Promise<void> {
    if (data.capture !== undefined) this.capture = data.capture;
    if (data.snap !== undefined && from === this.peer && this.capture) this.fx?.snap(data.snap);
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
      this.fx.onCapture = (image, u) => {
        if (!this.capture) return;
        void fetch('/api/ghosts', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.conn.authToken}` },
          body: JSON.stringify({ image, u, release: true }),
        }).catch(() => {});
      };
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

type Px = { x: number; y: number };
type Tint = [string, GlobalCompositeOperation, number];
/** Face colour per creature – only the face, the person keeps their own colours. */
const TINT: Partial<Record<Kind, Tint>> = {
  devil: ['#e0201a', 'color', 0.55],
  witch: ['#58b83a', 'color', 0.55],
  vampire: ['#f2eef8', 'source-over', 0.3],
  werewolf: ['#8a6a48', 'color', 0.35],
};
const ZOMBIE_TINTS: Tint[] = [
  ['#7fb86a', 'color', 0.55],
  ['#8a9ec0', 'color', 0.5],
  ['#a88ac8', 'color', 0.5],
  ['#c8d0b8', 'color', 0.45],
  ['#a2b060', 'color', 0.55],
];
/** Outline of the face (MediaPipe face oval). */
const OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149,
  150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

/**
 * Everything beyond the make-up: the creature's own features, drawn on the real face so the
 * person stays recognisable – hollow ghost eyes, skull paint, fangs, horns, fur and ears, a
 * witch's hat, a knife or an arrow stuck in a zombie's head.
 */
function drawCreature(g: CanvasRenderingContext2D, f: Px[], v: Variant, t: number): void {
  const P = (i: number) => f[i]!;
  const dist = (a: Px, b: Px) => Math.hypot(a.x - b.x, a.y - b.y);
  const lerp = (a: Px, b: Px, u: number): Px => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  const top = P(10);
  const chin = P(152);
  const hh = dist(top, chin);
  const fw = dist(P(234), P(454));
  // face directions: up (chin → forehead) and side (image left → right)
  const up = { x: (top.x - chin.x) / hh, y: (top.y - chin.y) / hh };
  const side = { x: -up.y, y: up.x };
  const at = (p: Px, s: number, u: number): Px => ({
    x: p.x + side.x * s + up.x * u,
    y: p.y + side.y * s + up.y * u,
  });
  const ang = Math.atan2(side.y, side.x);
  const eyeL = lerp(P(33), P(133), 0.5);
  const eyeR = lerp(P(362), P(263), 0.5);
  const ew = (dist(P(33), P(133)) + dist(P(362), P(263))) / 2;
  const mL = P(61);
  const mR = P(291);
  const mw = dist(mL, mR);
  const mc = lerp(P(13), P(14), 0.5);
  const oval = () => {
    g.beginPath();
    OVAL.forEach((i, k) => (k ? g.lineTo(P(i).x, P(i).y) : g.moveTo(P(i).x, P(i).y)));
    g.closePath();
  };
  const blob = (c: Px, rx: number, ry: number, col: string, soft = 0.35) => {
    g.save();
    g.translate(c.x, c.y);
    g.rotate(ang);
    g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, rx * (1 - soft), 0, 0, rx);
    gr.addColorStop(0, col);
    gr.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  const fangs = (len: number, lower = false) => {
    g.fillStyle = 'rgba(250,250,240,0.95)';
    g.strokeStyle = 'rgba(80,60,60,0.7)';
    g.lineWidth = Math.max(1, mw * 0.02);
    for (const u of [0.28, 0.72]) {
      const b = lerp(lower ? P(84) : P(37), lower ? P(314) : P(267), u < 0.5 ? 0.1 : 0.9);
      const base = lower ? at(b, 0, -mw * 0.02) : b;
      const d = lower ? 1 : -1;
      g.beginPath();
      g.moveTo(base.x - side.x * mw * 0.07, base.y - side.y * mw * 0.07);
      g.lineTo(base.x + side.x * mw * 0.07, base.y + side.y * mw * 0.07);
      const tip = at(base, 0, d * len);
      g.lineTo(tip.x, tip.y);
      g.closePath();
      g.fill();
      g.stroke();
    }
  };
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const tint = TINT[v.kind] ?? (v.kind === 'zombie' ? ZOMBIE_TINTS[v.seed % ZOMBIE_TINTS.length] : undefined);
  if (tint) {
    g.save();
    oval();
    g.clip();
    g.globalCompositeOperation = tint[1];
    g.globalAlpha = tint[2];
    g.fillStyle = tint[0];
    g.fillRect(top.x - hh * 2, top.y - hh * 2, hh * 4, hh * 4);
    g.restore();
  }
  switch (v.kind) {
    case 'ghost': {
      // a pale veil over the face, black hollow eyes and a long wailing mouth
      g.save();
      oval();
      g.clip();
      g.fillStyle = 'rgba(225,238,255,0.5)';
      g.fillRect(top.x - hh * 2, top.y - hh * 2, hh * 4, hh * 4);
      g.restore();
      const stretch = 1 + 0.08 * Math.sin(t * 2.2 + v.seed);
      for (const e of [eyeL, eyeR])
        blob(at(e, 0, -ew * 0.15), ew * 0.75, ew * 1.15 * stretch, 'rgba(5,5,15,0.95)', 0.3);
      blob(at(mc, 0, -hh * 0.06), mw * 0.32, hh * 0.2 * stretch, 'rgba(5,5,15,0.95)', 0.3);
      break;
    }
    case 'skeleton': {
      // skull paint: white face, black sockets, nose hole, teeth across the lips, hollow cheeks
      g.save();
      oval();
      g.clip();
      g.fillStyle = 'rgba(245,245,238,0.6)';
      g.fillRect(top.x - hh * 2, top.y - hh * 2, hh * 4, hh * 4);
      g.restore();
      for (const e of [eyeL, eyeR]) blob(e, ew * 0.85, ew * 0.8, 'rgba(10,10,15,0.95)', 0.2);
      blob(P(205), ew * 0.6, ew * 0.45, 'rgba(40,40,50,0.55)', 0.8);
      blob(P(425), ew * 0.6, ew * 0.45, 'rgba(40,40,50,0.55)', 0.8);
      const n = P(1);
      g.fillStyle = 'rgba(10,10,15,0.95)';
      g.beginPath();
      const a = at(n, -ew * 0.35, -ew * 0.05);
      const b = at(n, ew * 0.35, -ew * 0.05);
      const c = at(n, 0, ew * 0.6);
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.lineTo(c.x, c.y);
      g.closePath();
      g.fill();
      // teeth
      const L0 = at(mL, -mw * 0.12, 0);
      const R0 = at(mR, mw * 0.12, 0);
      const th = hh * 0.09;
      g.fillStyle = 'rgba(250,250,240,0.9)';
      g.strokeStyle = 'rgba(15,15,20,0.95)';
      g.lineWidth = Math.max(1, mw * 0.03);
      g.save();
      g.translate((L0.x + R0.x) / 2, (L0.y + R0.y) / 2);
      g.rotate(ang);
      const tw = dist(L0, R0);
      g.fillRect(-tw / 2, -th, tw, th * 2);
      g.strokeRect(-tw / 2, -th, tw, th * 2);
      g.beginPath();
      g.moveTo(-tw / 2, 0);
      g.lineTo(tw / 2, 0);
      for (let k = 1; k < 7; k++) {
        const x = -tw / 2 + (tw * k) / 7;
        g.moveTo(x, -th);
        g.lineTo(x, th);
      }
      g.stroke();
      g.restore();
      break;
    }
    case 'vampire': {
      // dark brows, widow's peak, fangs, a drop of blood
      g.fillStyle = 'rgba(15,10,20,0.85)';
      g.beginPath();
      const pk = at(top, 0, -hh * 0.06);
      const l = at(P(103), 0, hh * 0.08);
      const r = at(P(332), 0, hh * 0.08);
      g.moveTo(l.x, l.y);
      g.quadraticCurveTo(lerp(l, pk, 0.5).x, lerp(l, pk, 0.5).y + up.y * hh * 0.02, pk.x, pk.y);
      g.quadraticCurveTo(lerp(r, pk, 0.5).x, lerp(r, pk, 0.5).y + up.y * hh * 0.02, r.x, r.y);
      const rt = at(r, 0, hh * 0.25);
      const lt = at(l, 0, hh * 0.25);
      g.lineTo(rt.x, rt.y);
      g.lineTo(lt.x, lt.y);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(15,10,20,0.8)';
      g.lineWidth = Math.max(1.5, ew * 0.18);
      for (const [a, b] of [
        [70, 105],
        [300, 334],
      ] as const) {
        g.beginPath();
        g.moveTo(P(a).x, P(a).y);
        g.lineTo(P(b).x, P(b).y);
        g.stroke();
      }
      g.fillStyle = 'rgba(120,10,25,0.55)';
      g.beginPath();
      [61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91].forEach((i, k) =>
        k ? g.lineTo(P(i).x, P(i).y) : g.moveTo(P(i).x, P(i).y),
      );
      g.closePath();
      g.fill();
      fangs(hh * 0.09);
      const d = lerp(mL, P(17), 0.3);
      const len = hh * (0.1 + 0.05 * ((Math.sin(t * 0.7 + v.seed) + 1) / 2));
      const end = at(d, 0, -len);
      g.strokeStyle = 'rgba(170,0,20,0.9)';
      g.lineWidth = Math.max(1.5, mw * 0.05);
      g.beginPath();
      g.moveTo(d.x, d.y);
      g.lineTo(end.x, end.y);
      g.stroke();
      g.fillStyle = 'rgba(170,0,20,0.9)';
      g.beginPath();
      g.arc(end.x, end.y, Math.max(1.5, mw * 0.045), 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'devil': {
      // horns, sharp brows, a goatee and small fangs
      for (const s of [-1, 1]) {
        const base = at(top, s * fw * 0.24, hh * 0.08);
        const tip = at(top, s * fw * 0.42, hh * 0.62);
        const ctl = at(top, s * fw * 0.5, hh * 0.25);
        const w = fw * 0.09;
        const gr = g.createLinearGradient(base.x, base.y, tip.x, tip.y);
        gr.addColorStop(0, 'rgba(120,10,10,0.95)');
        gr.addColorStop(1, 'rgba(25,0,0,0.95)');
        g.fillStyle = gr;
        g.beginPath();
        const b1 = at(base, -w, 0);
        const b2 = at(base, w, 0);
        g.moveTo(b1.x, b1.y);
        g.quadraticCurveTo(ctl.x - side.x * w * 0.5, ctl.y - side.y * w * 0.5, tip.x, tip.y);
        g.quadraticCurveTo(ctl.x + side.x * w * 0.5, ctl.y + side.y * w * 0.5, b2.x, b2.y);
        g.closePath();
        g.fill();
      }
      g.strokeStyle = 'rgba(30,0,0,0.85)';
      g.lineWidth = Math.max(1.5, ew * 0.18);
      for (const [a, b] of [
        [55, 46],
        [285, 276],
      ] as const) {
        const A = P(a);
        const B = at(P(b), 0, ew * 0.35);
        g.beginPath();
        g.moveTo(A.x, A.y);
        g.lineTo(B.x, B.y);
        g.stroke();
      }
      g.fillStyle = 'rgba(25,0,0,0.85)';
      g.beginPath();
      const c1 = at(chin, -mw * 0.25, hh * 0.08);
      const c2 = at(chin, mw * 0.25, hh * 0.08);
      const c3 = at(chin, 0, -hh * 0.16);
      g.moveTo(c1.x, c1.y);
      g.lineTo(c2.x, c2.y);
      g.lineTo(c3.x, c3.y);
      g.closePath();
      g.fill();
      fangs(hh * 0.05);
      break;
    }
    case 'werewolf': {
      // fur around the face, pointed ears, a dark wolf nose and fangs
      g.strokeStyle = 'rgba(80,60,40,0.85)';
      for (let k = 0; k < OVAL.length; k++) {
        const p = P(OVAL[k]!);
        const cx = (top.x + chin.x) / 2;
        const cy = (top.y + chin.y) / 2;
        const d = Math.hypot(p.x - cx, p.y - cy) || 1;
        for (let j = 0; j < 3; j++) {
          const wob = Math.sin(k * 3.1 + j * 1.7 + v.seed) * 0.35;
          const len = hh * (0.14 + (0.1 * ((k * 7 + j * 3) % 5)) / 5);
          const ox = (p.x - cx) / d;
          const oy = (p.y - cy) / d;
          g.lineWidth = Math.max(1.5, hh * 0.03);
          g.strokeStyle = j === 1 ? 'rgba(170,135,95,0.9)' : 'rgba(115,85,55,0.9)';
          g.beginPath();
          g.moveTo(p.x - ox * hh * 0.03, p.y - oy * hh * 0.03);
          g.lineTo(p.x + (ox + wob * oy) * len, p.y + (oy - wob * ox) * len);
          g.stroke();
        }
      }
      for (const s of [-1, 1]) {
        const b1 = at(top, s * fw * 0.12, hh * 0.12);
        const b2 = at(top, s * fw * 0.45, hh * 0.02);
        const tip = at(top, s * fw * 0.42, hh * 0.55);
        g.fillStyle = 'rgba(135,100,65,0.97)';
        g.beginPath();
        g.moveTo(b1.x, b1.y);
        g.lineTo(tip.x, tip.y);
        g.lineTo(b2.x, b2.y);
        g.closePath();
        g.fill();
        const i1 = lerp(b1, b2, 0.25);
        const i2 = lerp(b1, b2, 0.75);
        const it = lerp(tip, lerp(b1, b2, 0.5), 0.3);
        g.fillStyle = 'rgba(180,120,110,0.8)';
        g.beginPath();
        g.moveTo(i1.x, i1.y);
        g.lineTo(it.x, it.y);
        g.lineTo(i2.x, i2.y);
        g.closePath();
        g.fill();
      }
      blob(P(1), ew * 0.5, ew * 0.38, 'rgba(15,10,10,0.95)', 0.25);
      g.strokeStyle = 'rgba(50,35,25,0.85)';
      g.lineWidth = Math.max(1.5, ew * 0.25);
      for (const [a, b] of [
        [70, 107],
        [300, 336],
      ] as const) {
        g.beginPath();
        g.moveTo(P(a).x, P(a).y);
        g.lineTo(P(b).x, P(b).y);
        g.stroke();
      }
      fangs(hh * 0.08);
      fangs(hh * 0.06, true);
      break;
    }
    case 'witch': {
      // a pointed hat, purple lips and a wart on the nose
      const brimC = at(top, 0, hh * 0.12);
      g.save();
      g.translate(brimC.x, brimC.y);
      g.rotate(ang);
      const bw = fw * 0.95;
      const tilt = Math.sin(t * 0.8 + v.seed) * 0.05 + (v.seed & 1 ? 0.15 : -0.15);
      g.fillStyle = 'rgba(25,15,35,0.97)';
      g.beginPath();
      g.moveTo(-bw * 0.55, -hh * 0.02);
      g.quadraticCurveTo(-bw * 0.2, -hh * 0.55, bw * 0.15 + tilt * hh, -hh * 0.95);
      g.quadraticCurveTo(bw * 0.2, -hh * 0.45, bw * 0.55, -hh * 0.02);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(120,40,160,0.95)';
      g.fillRect(-bw * 0.52, -hh * 0.14, bw * 1.04, hh * 0.09);
      g.fillStyle = 'rgba(230,200,60,0.95)';
      g.fillRect(-bw * 0.08, -hh * 0.15, bw * 0.16, hh * 0.11);
      g.fillStyle = 'rgba(25,15,35,0.97)';
      g.beginPath();
      g.ellipse(0, 0, bw, hh * 0.08, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.fillStyle = 'rgba(90,20,100,0.7)';
      g.beginPath();
      [61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91].forEach((i, k) =>
        k ? g.lineTo(P(i).x, P(i).y) : g.moveTo(P(i).x, P(i).y),
      );
      g.closePath();
      g.fill();
      const w = at(P(v.seed & 1 ? 49 : 279), 0, ew * 0.1);
      g.fillStyle = 'rgba(90,110,40,0.95)';
      g.beginPath();
      g.arc(w.x, w.y, Math.max(1.5, ew * 0.14), 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'zombie': {
      if (v.marks.includes('knife')) {
        // a kitchen knife stuck in the top of the head, with a bit of blood
        const s = v.seed & 1 ? 1 : -1;
        const hit = at(top, s * fw * 0.22, hh * 0.12);
        g.save();
        g.translate(hit.x, hit.y);
        g.rotate(ang + s * 0.5 - Math.PI / 2);
        const L = hh * 0.55;
        const B = hh * 0.1;
        g.fillStyle = 'rgba(205,210,220,0.97)';
        g.strokeStyle = 'rgba(60,60,70,0.9)';
        g.lineWidth = Math.max(1, hh * 0.01);
        g.beginPath();
        g.moveTo(0, -B * 0.5);
        g.lineTo(L * 0.5, -B * 0.5);
        g.lineTo(L * 0.5, B * 0.5);
        g.lineTo(0, B * 0.3);
        g.closePath();
        g.fill();
        g.stroke();
        g.fillStyle = 'rgba(55,30,20,0.97)';
        g.fillRect(L * 0.5, -B * 0.45, L * 0.5, B * 0.9);
        g.fillStyle = 'rgba(200,200,200,0.9)';
        for (const x of [0.62, 0.78, 0.92]) {
          g.beginPath();
          g.arc(L * x, 0, B * 0.12, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
        blob(hit, hh * 0.08, hh * 0.06, 'rgba(150,0,15,0.9)', 0.5);
        const drip = at(hit, s * fw * 0.03, -hh * (0.2 + 0.04 * Math.sin(t * 0.6 + v.seed)));
        g.strokeStyle = 'rgba(150,0,15,0.85)';
        g.lineWidth = Math.max(1.5, hh * 0.025);
        g.beginPath();
        g.moveTo(hit.x, hit.y);
        g.lineTo(drip.x, drip.y);
        g.stroke();
      } else if (v.marks.includes('arrow')) {
        // an arrow straight through the head: feathers on one side, tip on the other
        const y = hh * 0.32;
        const a = at(chin, -fw * 0.95, hh * 0.68 + y * 0.1);
        const b = at(chin, -fw * 0.42, hh * 0.68 + y * 0.05);
        const c = at(chin, fw * 0.42, hh * 0.66);
        const d = at(chin, fw * 0.8, hh * 0.64);
        g.strokeStyle = 'rgba(120,80,40,0.97)';
        g.lineWidth = Math.max(2, hh * 0.035);
        for (const [p, q] of [
          [a, b],
          [c, d],
        ] as const) {
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(q.x, q.y);
          g.stroke();
        }
        g.fillStyle = 'rgba(200,40,40,0.95)';
        for (const s of [-1, 1]) {
          const f1 = lerp(a, b, 0.05);
          const f2 = lerp(a, b, 0.35);
          g.beginPath();
          g.moveTo(f1.x + up.x * s * hh * 0.07, f1.y + up.y * s * hh * 0.07);
          g.lineTo(f2.x, f2.y);
          g.lineTo(f1.x, f1.y);
          g.closePath();
          g.fill();
        }
        g.fillStyle = 'rgba(170,175,185,0.97)';
        g.beginPath();
        const t1 = at(d, 0, hh * 0.05);
        const t2 = at(d, 0, -hh * 0.05);
        const t3 = at(d, fw * 0.14, 0);
        g.moveTo(t1.x, t1.y);
        g.lineTo(t3.x, t3.y);
        g.lineTo(t2.x, t2.y);
        g.closePath();
        g.fill();
        blob(b, hh * 0.05, hh * 0.05, 'rgba(150,0,15,0.85)', 0.5);
        blob(c, hh * 0.05, hh * 0.05, 'rgba(150,0,15,0.85)', 0.5);
      }
      break;
    }
    default:
      break;
  }
  g.restore();
}
