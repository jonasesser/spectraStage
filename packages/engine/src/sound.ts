/**
 * Procedural sound effects with Web Audio (no audio files → no licensing issues).
 * Each projection client plays its own sound. Audio requires one user gesture (unlock).
 */
import { createRng } from '@spectrastage/shared';

export interface SoundApi {
  readonly ctx: AudioContext | null;
  readonly out: AudioNode | null;
  /** Soft filtered-noise whoosh. */
  whoosh(opts?: { duration?: number; from?: number; to?: number; gain?: number; delay?: number }): void;
  /** Tonal glide (ghostly "oooh"). */
  ooh(opts?: { duration?: number; base?: number; gain?: number; delay?: number }): void;
  /** Bell / chime cluster. */
  chime(opts?: { notes?: number[]; gain?: number; spacing?: number; delay?: number }): void;
  /** Wooden knock(s). */
  knock(opts?: { count?: number; gain?: number; spacing?: number; delay?: number }): void;
  /** Soft distant thunder rumble (never loud). */
  rumble(opts?: { duration?: number; gain?: number; delay?: number }): void;
  /** Tiny pop / pluck. */
  pop(opts?: { freq?: number; gain?: number; delay?: number }): void;
  /** Wing flutter (bats). */
  flutter(opts?: { duration?: number; gain?: number; rate?: number; delay?: number }): void;
  /** Little scuttle (spider steps). */
  scuttle(opts?: { duration?: number; gain?: number; delay?: number }): void;
  /** Short melodic arpeggio. */
  arpeggio(opts?: {
    notes?: number[];
    gain?: number;
    step?: number;
    wave?: OscillatorType;
    delay?: number;
  }): void;
  /** Starts a looping ambience; returns a stop function. */
  ambience(kind: 'wind' | 'drone' | 'crickets', gain?: number): () => void;
}

export class SoundEngine implements SoundApi {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.8;
  private muted = false;
  private seed = 1;

  get out(): AudioNode | null {
    return this.master;
  }

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Call from a user gesture (click / key). Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
        this.comp = this.ctx.createDynamicsCompressor();
        this.comp.threshold.value = -18;
        this.comp.ratio.value = 6;
        this.master = this.ctx.createGain();
        this.master.connect(this.comp);
        this.comp.connect(this.ctx.destination);
        this.applyVolume();
        const len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        const rng = createRng(1234);
        for (let i = 0; i < len; i++) data[i] = rng() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* audio unavailable */
    }
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.muted = muted;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.master || !this.ctx) return;
    const v = this.muted ? 0 : this.volume * 0.9;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private ready(): AudioContext | null {
    if (!this.ctx || this.ctx.state !== 'running' || !this.master || this.muted || this.volume <= 0)
      return null;
    return this.ctx;
  }

  private env(g: GainNode, t0: number, peak: number, attack: number, release: number): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + release);
  }

  private noiseSource(ctx: AudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  whoosh({ duration = 1.2, from = 300, to = 1800, gain = 0.25, delay = 0 } = {}): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const src = this.noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(from, t0);
    bp.frequency.exponentialRampToValueAtTime(to, t0 + duration * 0.6);
    bp.frequency.exponentialRampToValueAtTime(from * 0.8, t0 + duration);
    const g = ctx.createGain();
    this.env(g, t0, gain, duration * 0.35, duration * 0.65);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t0, Math.random());
    src.stop(t0 + duration + 0.1);
  }

  ooh({ duration = 1.8, base = 220, gain = 0.12, delay = 0 } = {}): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    for (const [mult, detune] of [
      [1, 0],
      [1.5, 7],
      [2, -5],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * mult, t0);
      o.frequency.exponentialRampToValueAtTime(base * mult * 1.35, t0 + duration * 0.4);
      o.frequency.exponentialRampToValueAtTime(base * mult * 0.85, t0 + duration);
      o.detune.value = detune;
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vibG = ctx.createGain();
      vibG.gain.value = 9;
      vib.connect(vibG).connect(o.detune);
      const g = ctx.createGain();
      this.env(g, t0, gain / mult, duration * 0.3, duration * 0.7);
      o.connect(g).connect(this.master);
      o.start(t0);
      vib.start(t0);
      o.stop(t0 + duration + 0.1);
      vib.stop(t0 + duration + 0.1);
    }
  }

  chime({ notes = [784, 988, 1175, 1568], gain = 0.08, spacing = 0.09, delay = 0 } = {}): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    notes.forEach((f, i) => {
      const t0 = ctx.currentTime + delay + i * spacing;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 2.76;
      const g = ctx.createGain();
      this.env(g, t0, gain, 0.005, 1.4);
      const g2 = ctx.createGain();
      this.env(g2, t0, gain * 0.25, 0.005, 0.5);
      o.connect(g).connect(this.master!);
      o2.connect(g2).connect(this.master!);
      o.start(t0);
      o2.start(t0);
      o.stop(t0 + 1.6);
      o2.stop(t0 + 0.7);
    });
  }

  knock({ count = 3, gain = 0.35, spacing = 0.22, delay = 0 } = {}): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    for (let i = 0; i < count; i++) {
      const t0 = ctx.currentTime + delay + i * spacing;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(190, t0);
      o.frequency.exponentialRampToValueAtTime(70, t0 + 0.12);
      const g = ctx.createGain();
      this.env(g, t0, gain, 0.003, 0.14);
      const src = this.noiseSource(ctx);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const gn = ctx.createGain();
      this.env(gn, t0, gain * 0.5, 0.002, 0.05);
      o.connect(g).connect(this.master);
      src.connect(lp).connect(gn).connect(this.master);
      o.start(t0);
      o.stop(t0 + 0.2);
      src.start(t0, Math.random());
      src.stop(t0 + 0.08);
    }
  }

  rumble({ duration = 2.8, gain = 0.22, delay = 0 } = {}): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const src = this.noiseSource(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(320, t0);
    lp.frequency.exponentialRampToValueAtTime(90, t0 + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.35);
    g.gain.exponentialRampToValueAtTime(gain * 0.5, t0 + duration * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t0, Math.random());
    src.stop(t0 + duration + 0.1);
  }

  pop({ freq = 600, gain = 0.15, delay = 0 } = {}): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.8, t0);
    o.frequency.exponentialRampToValueAtTime(freq, t0 + 0.06);
    const g = ctx.createGain();
    this.env(g, t0, gain, 0.004, 0.12);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.2);
  }

  flutter({ duration = 1.5, gain = 0.12, rate = 18, delay = 0 } = {}): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const src = this.noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.8;
    const am = ctx.createGain();
    am.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = rate;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(am.gain);
    const g = ctx.createGain();
    this.env(g, t0, gain, 0.2, duration - 0.2);
    src.connect(bp).connect(am).connect(g).connect(this.master);
    src.start(t0, Math.random());
    lfo.start(t0);
    src.stop(t0 + duration + 0.1);
    lfo.stop(t0 + duration + 0.1);
  }

  scuttle({ duration = 0.8, gain = 0.06, delay = 0 } = {}): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    const rng = createRng(this.seed++);
    const steps = Math.floor(duration * 14);
    for (let i = 0; i < steps; i++) {
      const t0 = ctx.currentTime + delay + i * (duration / steps) + rng() * 0.02;
      const src = this.noiseSource(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500 + rng() * 2000;
      const g = ctx.createGain();
      this.env(g, t0, gain, 0.001, 0.025);
      src.connect(hp).connect(g).connect(this.master);
      src.start(t0, rng());
      src.stop(t0 + 0.04);
    }
  }

  arpeggio({
    notes = [262, 330, 392, 523],
    gain = 0.07,
    step = 0.12,
    wave = 'triangle',
    delay = 0,
  }: { notes?: number[]; gain?: number; step?: number; wave?: OscillatorType; delay?: number } = {}): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    notes.forEach((f, i) => {
      const t0 = ctx.currentTime + delay + i * step;
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.value = f;
      const g = ctx.createGain();
      this.env(g, t0, gain, 0.01, step * 2.5);
      o.connect(g).connect(this.master!);
      o.start(t0);
      o.stop(t0 + step * 3);
    });
  }

  ambience(kind: 'wind' | 'drone' | 'crickets', gain = 0.05): () => void {
    const ctx = this.ready();
    if (!ctx || !this.master) return () => {};
    const t0 = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 3);
    g.connect(this.master);
    const nodes: AudioScheduledSourceNode[] = [];
    if (kind === 'wind') {
      const src = this.noiseSource(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 500;
      bp.Q.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.08;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 300;
      lfo.connect(lfoG).connect(bp.frequency);
      src.connect(bp).connect(g);
      nodes.push(src, lfo);
    } else if (kind === 'drone') {
      for (const f of [55, 82.4, 110.3]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.value = 0.4;
        o.connect(og).connect(g);
        nodes.push(o);
      }
    } else {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 4400;
      const am = ctx.createGain();
      am.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 3.2;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.25;
      lfo.connect(lfoG).connect(am.gain);
      o.connect(am).connect(g);
      nodes.push(o, lfo);
    }
    for (const n of nodes) n.start(t0);
    return () => {
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0.0001, t, 0.5);
      for (const n of nodes) n.stop(t + 2);
    };
  }
}
