import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { CODE_ALPHABET, CODE_LENGTH } from '@spectrastage/shared';
import type { FastifyRequest } from 'fastify';
import type { Config } from './config.ts';

/** 256-bit capability token, URL-safe. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function newCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export function newId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

export function newSeed(): number {
  return randomInt(0, 2 ** 31 - 1);
}

/** Real client IP (Cloudflare header only trusted when explicitly configured). */
export function clientIp(req: FastifyRequest, config: Config): string {
  if (config.cloudflare) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.length > 0 && cf.length < 64) return cf;
  }
  return req.ip;
}

/** Simple in-memory token bucket rate limiter. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(private readonly rules: Record<string, { capacity: number; refillPerSec: number }>) {}

  take(rule: string, key: string, now = Date.now(), cost = 1): boolean {
    const r = this.rules[rule];
    if (!r) return true;
    const id = `${rule}:${key}`;
    const b = this.buckets.get(id) ?? { tokens: r.capacity, updated: now };
    b.tokens = Math.min(r.capacity, b.tokens + ((now - b.updated) / 1000) * r.refillPerSec);
    b.updated = now;
    if (b.tokens < cost) {
      this.buckets.set(id, b);
      return false;
    }
    b.tokens -= cost;
    this.buckets.set(id, b);
    return true;
  }

  sweep(now = Date.now()): void {
    for (const [k, b] of this.buckets) if (now - b.updated > 3600_000) this.buckets.delete(k);
  }
}

export function createLimiter(testMode: boolean): RateLimiter {
  const f = testMode ? 1000 : 1;
  return new RateLimiter({
    createSession: { capacity: 10 * f, refillPerSec: 10 / 3600 },
    pair: { capacity: 20 * f, refillPerSec: 20 / 600 },
    join: { capacity: 20 * f, refillPerSec: 20 / 600 },
    recover: { capacity: 20 * f, refillPerSec: 20 / 600 },
    rest: { capacity: 120 * f, refillPerSec: 4 },
    wsConnect: { capacity: 60 * f, refillPerSec: 1 },
    wsMessage: { capacity: 120 * f, refillPerSec: 60 },
    globalFailedPair: { capacity: 500 * f, refillPerSec: 1 },
  });
}
