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
const MAX_W = 480;

type Vision = typeof Mp;
type Segmenter = Mp.ImageSegmenter;
type FaceLm = Mp.FaceLandmarker;
type Pt = { x: number; y: number };

class ZombieFx {
  readonly canvas = document.createElement('canvas');
  private work = document.createElement('canvas');
  private tmp = document.createElement('canvas');
  private seg: Segmenter | null = null;
  private face: FaceLm | null = null;
  private faces: Pt[][] = [];
  private frame = 0;
  private box: { x: number; y: number; w: number; h: number } | null = null;
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
          runningMode: 'VIDEO',
          numFaces: 4,
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
    if (this.face && this.frame++ % 2 === 0) {
      try {
        const r = this.face.detectForVideo(this.work, ts);
        this.faces = r.faceLandmarks.map((f: Mp.NormalizedLandmark[]) =>
          f.map((p) => ({ x: p.x * W, y: p.y * H })),
        );
      } catch {
        /* skip this frame */
      }
    }
    if (!mask) return;
    const m: Float32Array = mask;
    const img = wg.getImageData(0, 0, W, H);
    const d = img.data;
    // where the people are (to cut them out and show them big, however far from the camera)
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    for (let y = 0; y < H; y += 2)
      for (let x = 0; x < W; x += 2)
        if (m[y * W + x]! > 0.6) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 <= x0 || y1 <= y0) {
      this.box = null;
      const g0 = this.canvas.getContext('2d')!;
      g0.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    const pad = (y1 - y0) * 0.06;
    const nb = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
    const b = this.box;
    this.box = b
      ? {
          x: b.x + (nb.x - b.x) * 0.25,
          y: b.y + (nb.y - b.y) * 0.25,
          w: b.w + (nb.w - b.w) * 0.25,
          h: b.h + (nb.h - b.h) * 0.25,
        }
      : nb;
    const box = this.box;
    const tail = box.y + box.h * 0.68;
    const tailEnd = box.y + box.h;
    for (let y = 0; y < H; y++) {
      const fade = y < tail ? 1 : Math.max(0, 1 - (y - tail) / Math.max(1, tailEnd - tail));
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const p = i * 4;
        const c = m[i]!;
        const a = c <= 0.35 ? 0 : c >= 0.75 ? 1 : (c - 0.35) / 0.4;
        if (a <= 0) {
          d[p + 3] = 0;
          continue;
        }
        // cartoon zombie skin: a few green levels from the brightness
        const l = (0.3 * d[p]! + 0.59 * d[p + 1]! + 0.11 * d[p + 2]!) / 255;
        const q = Math.min(1, Math.floor(l * 5 + 0.5) / 5 + 0.08);
        d[p] = 52 + 150 * q;
        d[p + 1] = 92 + 160 * q;
        d[p + 2] = 64 + 110 * q;
        d[p + 3] = 255 * a * fade * 0.93;
      }
    }
    const tg = this.tmp.getContext('2d')!;
    tg.putImageData(img, 0, 0);
    this.drawFaces(tg, ts / 1000);
    // cut out the people (sprite = their box), with a ghostly glow around them
    const ow = Math.max(8, Math.round(box.w));
    const oh = Math.max(8, Math.round(box.h));
    if (this.canvas.width !== ow || this.canvas.height !== oh) {
      this.canvas.width = ow;
      this.canvas.height = oh;
    }
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, ow, oh);
    g.drawImage(this.tmp, box.x, box.y, box.w, box.h, 0, 0, ow, oh);
    g.save();
    g.globalCompositeOperation = 'destination-over';
    g.filter = `blur(${Math.max(2, Math.round(oh / 45))}px) brightness(1.7)`;
    g.globalAlpha = 0.8;
    g.drawImage(this.tmp, box.x, box.y, box.w, box.h, 0, 0, ow, oh);
    g.restore();
  }

  private drawFaces(g: CanvasRenderingContext2D, t: number): void {
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
  private alpha = 0;
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

  private sprite(): LiveSprite | null {
    const now = performance.now();
    const dt = Math.min(100, now - (this.lastFrame || now)) / 1000;
    this.lastFrame = now;
    const target = this.live && this.fx?.ready ? 1 : 0;
    this.alpha += Math.sign(target - this.alpha) * Math.min(Math.abs(target - this.alpha), dt * 0.8);
    if (this.alpha <= 0.001 || !this.fx) return null;
    return { canvas: this.fx.canvas, alpha: this.alpha };
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
