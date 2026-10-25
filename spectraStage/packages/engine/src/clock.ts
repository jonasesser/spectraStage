/**
 * Server clock estimation (NTP-like): keep the samples with the lowest round-trip time and
 * slew the applied offset gradually to avoid visible animation jumps.
 */
export interface ClockStats {
  offsetMs: number;
  rttMs: number;
  jitterMs: number;
  samples: number;
}

function mono(): number {
  return performance.timeOrigin + performance.now();
}

export class ServerClock {
  private samples: { offset: number; rtt: number; at: number }[] = [];
  private applied: number | null = null;
  private target = 0;
  private lastSlew = mono();

  /** Feed one ping/pong exchange (t0 = local send time from `localNow()`). */
  addSample(t0: number, serverTime: number, t1 = mono()): void {
    const rtt = Math.max(0, t1 - t0);
    const offset = serverTime + rtt / 2 - t1;
    this.samples.push({ offset, rtt, at: t1 });
    if (this.samples.length > 16) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 4);
    this.target = best.reduce((s, x) => s + x.offset, 0) / best.length;
    if (this.applied === null || Math.abs(this.target - this.applied) > 1000) this.applied = this.target;
  }

  localNow(): number {
    return mono();
  }

  /** Synchronized server time in ms. */
  now(): number {
    const m = mono();
    if (this.applied === null) return Date.now();
    // Slew at most 5 ms per 100 ms of real time (5%).
    const dt = m - this.lastSlew;
    this.lastSlew = m;
    const diff = this.target - this.applied;
    const maxStep = dt * 0.05;
    this.applied += Math.max(-maxStep, Math.min(maxStep, diff));
    return m + this.applied;
  }

  get synced(): boolean {
    return this.applied !== null;
  }

  stats(): ClockStats {
    if (this.samples.length === 0) return { offsetMs: 0, rttMs: 0, jitterMs: 0, samples: 0 };
    const rtts = this.samples.map((s) => s.rtt);
    const mean = rtts.reduce((a, b) => a + b, 0) / rtts.length;
    const jitter = Math.sqrt(rtts.reduce((a, b) => a + (b - mean) ** 2, 0) / rtts.length);
    return {
      offsetMs: this.applied ?? 0,
      rttMs: Math.min(...rtts.slice(-6)),
      jitterMs: jitter,
      samples: this.samples.length,
    };
  }
}
