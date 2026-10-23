export interface Config {
  publicUrl: string | null;
  port: number;
  host: string;
  trustProxy: boolean;
  cloudflare: boolean;
  databasePath: string;
  sessionTtlDays: number;
  maxSessions: number;
  maxDevicesPerSession: number;
  pairingCodeTtlMs: number;
  inviteTtlMs: number;
  logLevel: string;
  webRoot: string | null;
  /** Relaxes rate limits (tests). */
  testMode: boolean;
}

function num(v: string | undefined, d: number): number {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

function bool(v: string | undefined, d: boolean): boolean {
  if (v === undefined || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const publicUrl = env.PUBLIC_URL?.trim() ? env.PUBLIC_URL.trim().replace(/\/$/, '') : null;
  return {
    publicUrl,
    port: num(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    trustProxy: bool(env.TRUST_PROXY, false),
    cloudflare: bool(env.CLOUDFLARE, false),
    databasePath: env.DATABASE_PATH || './data/spectrastage.db',
    sessionTtlDays: num(env.SESSION_TTL_DAYS, 0),
    maxSessions: num(env.MAX_SESSIONS, 20000),
    maxDevicesPerSession: num(env.MAX_DEVICES_PER_SESSION, 16),
    pairingCodeTtlMs: num(env.PAIRING_CODE_TTL_MINUTES, 15) * 60_000,
    inviteTtlMs: 15 * 60_000,
    logLevel: env.LOG_LEVEL || 'info',
    webRoot: env.WEB_ROOT || null,
    testMode: false,
    ...overrides,
  };
}
