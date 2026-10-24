/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON in tests */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { catalog } from '@spectrastage/catalog/manifests';
import { PROTOCOL_VERSION, type Command, type ServerMessage, type SessionState } from '@spectrastage/shared';
import { loadConfig } from './config.ts';
import { buildApp, type AppContext } from './app.ts';

let dir: string;
let ctx: AppContext;
let base: string;

async function start() {
  const config = loadConfig(
    {},
    { databasePath: join(dir, 'test.db'), testMode: true, port: 0, host: '127.0.0.1' },
  );
  ctx = await buildApp(config, catalog);
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = ctx.app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `127.0.0.1:${addr.port}`;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'spectra-'));
  await start();
});
afterEach(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`http://${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

class TestClient {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  state: SessionState | null = null;
  secrets: any = null;
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  constructor(token: string) {
    this.ws = new WebSocket(`ws://${base}/ws`);
    this.ws.on('open', () =>
      this.ws.send(
        JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, token, clientId: 'test-client' }),
      ),
    );
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMessage;
      this.messages.push(m);
      if (m.type === 'snapshot') {
        if (!this.state || m.state.revision >= this.state.revision) this.state = m.state;
        if (m.secrets) this.secrets = m.secrets;
      }
      for (const w of [...this.waiters]) {
        if (w.pred(m)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    });
  }
  wait(pred: (m: ServerMessage) => boolean, timeout = 3000): Promise<ServerMessage> {
    const found = this.messages.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for message')), timeout);
      this.waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  }
  async cmd(cmd: Command): Promise<ServerMessage> {
    const id = `cmd-${Math.random().toString(36).slice(2)}`;
    this.ws.send(JSON.stringify({ type: 'cmd', id, cmd }));
    return this.wait((m) => (m.type === 'ack' || m.type === 'nack') && m.id === id);
  }
  close() {
    this.ws.close();
  }
}

async function createShow() {
  const { status, data } = await api('POST', '/api/sessions', { name: 'Test' });
  expect(status).toBe(201);
  const owner = new TestClient(data.ownerToken);
  await owner.wait((m) => m.type === 'snapshot');
  return { owner, ownerToken: data.ownerToken as string, sessionId: data.sessionId as string };
}

async function pairDevice(owner: TestClient, name: string) {
  const code = owner.secrets.pairingCode as string;
  const pair = await api('POST', '/api/pair', {
    code: `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase(),
    name,
  });
  expect(pair.status).toBe(201);
  const dev = new TestClient(pair.data.pendingToken);
  await owner.wait((m) => m.type === 'snapshot' && m.state.devices.some((d) => d.id === pair.data.deviceId));
  const ack = await owner.cmd({
    t: 'device.approve',
    deviceId: pair.data.deviceId,
    newOutput: { name, newSurface: { name, kind: 'wall' } },
  });
  expect(ack.type).toBe('ack');
  const approved = (await dev.wait((m) => m.type === 'approved')) as Extract<
    ServerMessage,
    { type: 'approved' }
  >;
  await dev.wait((m) => m.type === 'snapshot');
  return { dev, deviceToken: approved.deviceToken, deviceId: pair.data.deviceId as string };
}

describe('sessions & pairing', () => {
  it('creates an anonymous show with a pairing code and approves three devices', async () => {
    const { owner } = await createShow();
    expect(owner.secrets.pairingCode).toMatch(/^[A-Z2-9]{8}$/);
    const devices = [];
    for (const n of ['Garage', 'Wall', 'Ground']) devices.push(await pairDevice(owner, n));
    // a new show comes with 6 planned projectors (one per room side) + 3 approved devices
    await owner.wait((m) => m.type === 'snapshot' && m.state.outputs.length === 9);
    expect(owner.state!.outputs.filter((o) => o.profiles[0]!.pose).length).toBe(9);
    expect(owner.state!.surfaces).toHaveLength(5); // 2 starter surfaces + 3 new
    expect(owner.state!.devices.every((d) => d.status === 'approved' && d.outputId)).toBe(true);
    for (const d of devices) d.dev.close();
    owner.close();
  });

  it('pending devices cannot see state or send commands; pairing code is not an admin credential', async () => {
    const { owner } = await createShow();
    const code = owner.secrets.pairingCode as string;
    const pair = await api('POST', '/api/pair', { code, name: 'Intruder' });
    const pending = new TestClient(pair.data.pendingToken);
    await new Promise((r) => setTimeout(r, 300));
    expect(pending.messages.some((m) => m.type === 'snapshot')).toBe(false);
    const nack = await pending.cmd({ t: 'session.blackoutAll', on: true });
    expect(nack.type).toBe('nack');
    // code itself cannot be used as token
    const asToken = await api('POST', '/api/pairing-code', {}, code);
    expect(asToken.status).toBe(401);
    // invalid codes are rejected
    expect((await api('POST', '/api/pair', { code: 'AAAAAAAA', name: 'x' })).status).toBe(404);
    pending.close();
    owner.close();
  });

  it('isolates two shows completely', async () => {
    const a = await createShow();
    const b = await createShow();
    const devA = await pairDevice(a.owner, 'A-Garage');
    expect(b.owner.state!.devices).toHaveLength(0);
    // B cannot address A's surfaces
    const sA = a.owner.state!.surfaces[0]!.id;
    const nack = await b.owner.cmd({
      t: 'output.blackout',
      outputIds: [a.owner.state!.outputs[0]!.id],
      on: true,
    });
    expect(nack.type).toBe('nack');
    const nack2 = await b.owner.cmd({
      t: 'effect.fire',
      surfaceIds: [sA],
      themeId: 'halloween',
      effectId: 'boo',
    });
    expect(nack2.type).toBe('nack');
    devA.dev.close();
    a.owner.close();
    b.owner.close();
  });

  it('co-controller invite works and cannot approve devices', async () => {
    const { owner, ownerToken } = await createShow();
    const inv = await api('POST', '/api/invites', {}, ownerToken);
    expect(inv.status).toBe(200);
    const join = await api('POST', '/api/join', { code: inv.data.code, name: 'Helper' });
    expect(join.status).toBe(201);
    const again = await api('POST', '/api/join', { code: inv.data.code, name: 'Helper2' });
    expect(again.status).toBe(404); // single use
    const helper = new TestClient(join.data.token);
    await helper.wait((m) => m.type === 'snapshot');
    const pair = await api('POST', '/api/pair', { code: owner.secrets.pairingCode, name: 'Dev' });
    await helper.wait((m) => m.type === 'snapshot' && m.state.devices.length === 1);
    const r = await helper.cmd({ t: 'device.approve', deviceId: pair.data.deviceId });
    expect(r.type).toBe('nack');
    const ok = await helper.cmd({ t: 'session.blackoutAll', on: true });
    expect(ok.type).toBe('ack');
    helper.close();
    owner.close();
  });
});

describe('reliability', () => {
  it('deduplicates resent commands and survives a server restart', async () => {
    const { owner, ownerToken } = await createShow();
    const { dev, deviceToken } = await pairDevice(owner, 'Garage');
    const id = 'dup-command-1';
    owner.ws.send(JSON.stringify({ type: 'cmd', id, cmd: { t: 'session.rename', name: 'Renamed' } }));
    const first = (await owner.wait((m) => m.type === 'ack' && m.id === id)) as { revision: number };
    owner.ws.send(JSON.stringify({ type: 'cmd', id, cmd: { t: 'session.rename', name: 'Renamed' } }));
    await new Promise((r) => setTimeout(r, 200));
    const acks = owner.messages.filter((m) => m.type === 'ack' && m.id === id) as { revision: number }[];
    expect(acks).toHaveLength(2);
    expect(acks[1]!.revision).toBe(first.revision);

    const outputId = owner.state!.outputs[0]!.id;
    const profile = structuredClone(owner.state!.outputs[0]!.profiles[0]!);
    profile.corners[0] = { x: 0.05, y: 0.04 };
    expect((await owner.cmd({ t: 'output.saveProfile', outputId, profile, activate: true })).type).toBe(
      'ack',
    );
    dev.close();
    owner.close();

    // restart
    await ctx.close();
    await start();
    const owner2 = new TestClient(ownerToken);
    const snap = (await owner2.wait((m) => m.type === 'snapshot')) as Extract<
      ServerMessage,
      { type: 'snapshot' }
    >;
    expect(snap.state.name).toBe('Renamed');
    expect(snap.state.outputs[0]!.profiles[0]!.corners[0]).toEqual({ x: 0.05, y: 0.04 });
    const dev2 = new TestClient(deviceToken);
    await dev2.wait((m) => m.type === 'snapshot');
    expect((dev2.messages.find((m) => m.type === 'welcome') as { role: string }).role).toBe('device');
    dev2.close();
    owner2.close();
  });

  it('schedules effect cues in the future and does not replay expired ones on reconnect', async () => {
    const { owner } = await createShow();
    const { dev, deviceToken } = await pairDevice(owner, 'Garage');
    const surfaceId = owner.state!.surfaces[0]!.id;
    const t0 = Date.now();
    expect(
      (await owner.cmd({ t: 'effect.fire', surfaceIds: [surfaceId], themeId: 'halloween', effectId: 'boo' }))
        .type,
    ).toBe('ack');
    const cue = owner.state!.cues[0]!;
    expect(cue.startAt).toBeGreaterThanOrEqual(t0 + 150);
    // cooldown
    expect(
      (await owner.cmd({ t: 'effect.fire', surfaceIds: [surfaceId], themeId: 'halloween', effectId: 'boo' }))
        .type,
    ).toBe('nack');
    dev.close();
    // later: a reconnecting device must not get the ended cue
    await new Promise((r) => setTimeout(r, 50));
    const fakeNow = Date.now() + 10_000;
    const realNow = Date.now;
    Date.now = () => fakeNow;
    try {
      await owner.cmd({ t: 'session.rename', name: 'Later' });
    } finally {
      Date.now = realNow;
    }
    const dev2 = new TestClient(deviceToken);
    const snap = (await dev2.wait((m) => m.type === 'snapshot')) as Extract<
      ServerMessage,
      { type: 'snapshot' }
    >;
    expect(snap.state.cues).toHaveLength(0);
    dev2.close();
    owner.close();
  });

  it('revoking a device closes its connection and invalidates its token', async () => {
    const { owner } = await createShow();
    const { dev, deviceToken, deviceId } = await pairDevice(owner, 'Garage');
    expect((await owner.cmd({ t: 'device.remove', deviceId })).type).toBe('ack');
    await dev.wait((m) => m.type === 'error');
    const again = new TestClient(deviceToken);
    const err = (await again.wait((m) => m.type === 'error')) as { code: string };
    expect(err.code).toBe('unauthorized');
    again.close();
    owner.close();
  });

  it('spawns an actor run from garage to wall with a deterministic end time', async () => {
    const { owner } = await createShow();
    const a = await pairDevice(owner, 'Garage');
    const b = await pairDevice(owner, 'Wall');
    const [g, w] = owner.state!.surfaces;
    const ack = await owner.cmd({
      t: 'actor.spawn',
      themeId: 'halloween',
      actorId: 'spider',
      count: 2,
      speed: 1,
      fromSurfaceId: g!.id,
      toSurfaceId: w!.id,
    });
    expect(ack.type).toBe('ack');
    await a.dev.wait((m) => m.type === 'snapshot' && m.state.cues.some((c) => c.kind === 'actor'));
    const cueA = a.dev.state!.cues.find((c) => c.kind === 'actor')!;
    await b.dev.wait((m) => m.type === 'snapshot' && m.state.cues.some((c) => c.id === cueA.id));
    const cueB = b.dev.state!.cues.find((c) => c.id === cueA.id)!;
    expect(cueB).toEqual(cueA);
    expect(cueA.endAt - cueA.startAt).toBeGreaterThan(2000);
    a.dev.close();
    b.dev.close();
    owner.close();
  });

  it('export / import round trip', async () => {
    const { owner, ownerToken } = await createShow();
    await pairDevice(owner, 'Garage');
    const exp = await api('GET', '/api/sessions/export', undefined, ownerToken);
    expect(exp.data.format).toBe('spectrastage-show');
    exp.data.show.surfaces[0].name = 'Imported';
    const imp = await api('POST', '/api/sessions/import', exp.data, ownerToken);
    expect(imp.status).toBe(200);
    await owner.wait((m) => m.type === 'snapshot' && m.state.surfaces[0]?.name === 'Imported');
    owner.close();
  });

  it('auto mode: schedule applies preset, boost and blackout once per entry', async () => {
    const { owner } = await createShow();
    const ack = await owner.cmd({
      t: 'session.setSchedule',
      schedule: {
        enabled: true,
        timezone: 'UTC',
        entries: [
          {
            id: 'e1',
            at: '00:00',
            themeId: 'halloween',
            presetId: 'quietAtmosphere',
            boost: 0.6,
            blackout: false,
          },
        ],
      },
    });
    expect(ack.type).toBe('ack');
    ctx.hub.scheduleTick();
    const snap = (await owner.wait((m) => m.type === 'snapshot' && m.state.boost === 0.6)) as Extract<
      ServerMessage,
      { type: 'snapshot' }
    >;
    expect(snap.state.schedule?.lastApplied).toMatch(/\|e1$/);
    expect(snap.state.surfaces[0]!.playback.mode).toBe('scene'); // quietAtmosphere assigns scenes
    const rev = snap.state.revision;
    ctx.hub.scheduleTick();
    await new Promise((r) => setTimeout(r, 150));
    expect(owner.state!.revision).toBe(rev); // not applied twice
    owner.close();
  });
});
