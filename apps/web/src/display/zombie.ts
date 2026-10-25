/**
 * Zombie camera on the projector PC: receives the phone's camera (WebRTC), cuts the people out
 * (MediaPipe selfie segmentation), makes them funny zombie ghosts (green cartoon skin, glowing
 * edge, ghost tail, googly eyes in dark rings, crooked teeth, a stitched scar – from MediaPipe
 * face landmarks) and hands the picture to the renderer, which lets it drift along the main wall.
 * Runs entirely in the browser; nothing is stored.
 */
import type { LiveSprite, StageRenderer } from '@spectrastage/engine';
import type { RtcData } from '@spectrastage/shared';
import type { Connection } from '../lib/connection.ts';
import type * as Mp from '@mediapipe/tasks-vision';

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const MAX_W = 640;

type Vision = typeof Mp;
type Segmenter = Mp.ImageSegmenter;
type FaceLm = Mp.FaceLandmarker;
type Pt = { x: number; y: number };
interface Person {
  id: number;
  box: { x: number; y: number; w: number; h: number };
  canvas: HTMLCanvasElement;
  seen: number;
  alpha: number;
  label: number;
  faces: Pt[][];
}

export class ZombieFx {
  private work = document.createElement('canvas');
  private tmp = document.createElement('canvas');
  private seg: Segmenter | null = null;
  private face: FaceLm | null = null;
  private faces: Pt[][] = [];
  private frame = 0;
  private people: Person[] = [];
  /** makeup: the person stays recognisable · comic: cartoon colours with googly eyes. */
  style: 'makeup' | 'comic' = 'makeup';
  private nextId = 1;
  private glow = document.createElement('canvas');
  ready = false;
  failed = false;

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
          minFaceDetectionConfidence: 0.3,
          minFacePresenceConfidence: 0.3,
          minTrackingConfidence: 0.3,
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
    // zombie colours for the whole picture
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const c = m[i]!;
      // solid person, soft only right at the outline
      const a = c <= 0.3 ? 0 : c >= 0.55 ? 1 : (c - 0.3) / 0.25;
      if (a <= 0) {
        d[p + 3] = 0;
        continue;
      }
      const l = (0.3 * d[p]! + 0.59 * d[p + 1]! + 0.11 * d[p + 2]!) / 255;
      if (this.style === 'comic') {
        // cartoon zombie skin: a few green levels from the brightness
        const q = Math.min(1, Math.floor(l * 5 + 0.5) / 5 + 0.08);
        d[p] = 52 + 150 * q;
        d[p + 1] = 92 + 160 * q;
        d[p + 2] = 64 + 110 * q;
        d[p + 3] = 255 * a;
      } else {
        // zombie make-up: every detail of the person stays (recognisable), colours turn pale
        // grey-green with a bit more contrast
        const gray = l * 255;
        const r0 = d[p]! * 0.65 + gray * 0.35;
        const g0 = d[p + 1]! * 0.65 + gray * 0.35;
        const b0 = d[p + 2]! * 0.65 + gray * 0.35;
        // lifted: a ghost must glow on the dark scene, also in dark clothes
        const k = (x: number) => Math.max(0, Math.min(255, 34 + ((x - 128) * 1.08 + 128) * 0.9));
        d[p] = k(r0 * 0.88);
        d[p + 1] = k(g0 * 1.02 + 12);
        d[p + 2] = k(b0 * 0.86);
        d[p + 3] = 255 * a;
      }
    }
    const tg = this.tmp.getContext('2d')!;
    tg.putImageData(img, 0, 0);
    // follow the people from picture to picture (stable ids → stable places on the wall)
    const now = performance.now();
    const found = comps
      .map((c, k) => ({ k, c }))
      .filter(({ c }) => c.n >= gw * gh * 0.004 && (c.y1 - c.y0 + 1) * C >= H * 0.15);
    const used = new Set<Person>();
    const active: Person[] = [];
    for (const { k, c } of found) {
      const pad = (c.y1 - c.y0 + 1) * C * 0.06;
      const nb = {
        x: c.x0 * C - pad,
        y: c.y0 * C - pad,
        w: (c.x1 - c.x0 + 1) * C + pad * 2,
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
        best = {
          id: this.nextId++,
          box: nb,
          canvas: document.createElement('canvas'),
          seen: now,
          alpha: 0,
          label: k,
          faces: [],
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
    // faces per person (on their head area, so every face is found – also small ones in a group)
    for (const pr of active) if ((this.frame + pr.id) % 2 === 0) pr.faces = this.findFaces(pr);
    this.faces = active.flatMap((pr) => pr.faces);
    this.drawFaces(tg, ts / 1000);
    for (const pr of active) this.cutOut(pr, H, lab, gw, C);
  }

  private faceCanvas = document.createElement('canvas');
  private findFaces(pr: Person): Pt[][] {
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
      return r.faceLandmarks.map((f: Mp.NormalizedLandmark[]) =>
        f.map((p) => ({ x: x + p.x * w, y: y + p.y * h })),
      );
    } catch {
      return pr.faces;
    }
  }

  /** One person as their own sprite: their box, others in it removed, ghost tail, glow. */
  private cutOut(pr: Person, H: number, lab: Int32Array, gw: number, C: number): void {
    const box = pr.box;
    const ow = Math.max(8, Math.round(box.w));
    const oh = Math.max(8, Math.round(box.h));
    const cv = pr.canvas;
    if (cv.width !== ow || cv.height !== oh) {
      cv.width = ow;
      cv.height = oh;
    }
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, ow, oh);
    g.drawImage(this.tmp, box.x, box.y, box.w, box.h, 0, 0, ow, oh);
    // remove the neighbours that reach into this box
    const sx = ow / box.w;
    const sy = oh / box.h;
    const gx0 = Math.max(0, Math.floor(box.x / C));
    const gy0 = Math.max(0, Math.floor(box.y / C));
    const gx1 = Math.min(gw - 1, Math.ceil((box.x + box.w) / C));
    const gy1 = Math.min(Math.ceil(H / C) - 1, Math.ceil((box.y + box.h) / C));
    for (let gy = gy0; gy <= gy1; gy++)
      for (let gx = gx0; gx <= gx1; gx++) {
        const l = lab[gy * gw + gx]!;
        if (l !== -1 && l !== pr.label)
          g.clearRect((gx * C - box.x - 1) * sx, (gy * C - box.y - 1) * sy, (C + 2) * sx, (C + 2) * sy);
      }
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
      const target = on && now - pr.seen < 1500 ? 1 : 0;
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
    if (this.style === 'makeup') return this.drawMakeup(g);
    const avg = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    this.faces.forEach((f, n) => {
      if (f.length < 400) return;
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
   * Zombie make-up on the real face (stays recognisable): sunken dark eye sockets, glowing
   * yellow-green irises on the real eyes, dark lips, green veins at the temples, a small stitched
   * scar on the forehead.
   */
  private drawMakeup(g: CanvasRenderingContext2D): void {
    const avg = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    for (const f of this.faces) {
      if (f.length < 468) continue;
      const eyes = [avg(f[33]!, f[133]!), avg(f[362]!, f[263]!)];
      const ew = (dist(f[33]!, f[133]!) + dist(f[362]!, f[263]!)) / 2;
      g.save();
      // sunken eye sockets (darken, the eye itself stays visible)
      g.globalCompositeOperation = 'multiply';
      for (const e of eyes) {
        const gr = g.createRadialGradient(e.x, e.y + ew * 0.1, ew * 0.25, e.x, e.y + ew * 0.1, ew * 1.05);
        gr.addColorStop(0, 'rgba(70,40,90,0.9)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(e.x, e.y + ew * 0.1, ew * 1.05, 0, Math.PI * 2);
        g.fill();
      }
      // dark lips
      const lips = [61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91];
      g.fillStyle = 'rgba(60,30,60,0.55)';
      g.beginPath();
      lips.forEach((i, k) => (k ? g.lineTo(f[i]!.x, f[i]!.y) : g.moveTo(f[i]!.x, f[i]!.y)));
      g.closePath();
      g.fill();
      g.restore();
      // glowing irises on the real eyes
      if (f.length >= 478) {
        g.save();
        g.globalCompositeOperation = 'screen';
        for (const i of [468, 473]) {
          const c = f[i]!;
          const r = ew * 0.2;
          const gr = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 1.8);
          gr.addColorStop(0, 'rgba(230,255,90,0.75)');
          gr.addColorStop(0.5, 'rgba(160,255,60,0.35)');
          gr.addColorStop(1, 'rgba(120,255,40,0)');
          g.fillStyle = gr;
          g.beginPath();
          g.arc(c.x, c.y, r * 1.8, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
      }
      // veins at the temples
      g.save();
      g.strokeStyle = 'rgba(30,70,40,0.6)';
      g.lineWidth = Math.max(1, ew * 0.05);
      g.lineCap = 'round';
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
      // small stitched scar on the forehead
      const s0 = f[67]!;
      const s1 = f[10]!;
      const a0 = { x: s0.x + (s1.x - s0.x) * 0.2, y: s0.y + ew * 0.35 };
      const a1 = { x: s0.x + (s1.x - s0.x) * 0.85, y: s1.y + ew * 0.55 };
      g.strokeStyle = 'rgba(110,30,45,0.85)';
      g.lineWidth = Math.max(1.5, ew * 0.09);
      g.beginPath();
      g.moveTo(a0.x, a0.y);
      g.lineTo(a1.x, a1.y);
      g.stroke();
      g.lineWidth = Math.max(1, ew * 0.05);
      for (let k = 1; k <= 3; k++) {
        const u = k / 4;
        const x = a0.x + (a1.x - a0.x) * u;
        const y = a0.y + (a1.y - a0.y) * u;
        g.beginPath();
        g.moveTo(x - ew * 0.1, y - ew * 0.17);
        g.lineTo(x + ew * 0.1, y + ew * 0.17);
        g.stroke();
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
  private style: 'makeup' | 'comic' = 'makeup';
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
    if (data.style) this.style = data.style;
    if (this.fx) this.fx.style = this.style;
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
      this.fx.style = this.style;
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
