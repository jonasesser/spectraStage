import type { WebSocket } from 'ws';
import {
  planRoomOutputs,
  applyCommand,
  applyReportedResolution,
  CommandError,
  createInitialState,
  createSurface,
  cueLeadMs,
  normalizeCode,
  isValidCode,
  pruneCues,
  type Command,
  type ControllerSecrets,
  type Presence,
  type Profile,
  type RtcData,
  type Role,
  type ServerMessage,
  type SessionState,
  type Telemetry,
  type ThemeCatalog,
} from '@spectrastage/shared';
import type { Store, TokenRow } from './db.ts';
import type { Config } from './config.ts';
import { hashSecret, newCode, newId, newSeed, newToken } from './security.ts';

export interface Client {
  ws: WebSocket;
  role: Role;
  sessionId: string;
  subjectId: string;
  clientId: string;
  alive: boolean;
}

interface LiveSession {
  state: SessionState;
  clients: Set<Client>;
  presence: Presence;
  dedup: Map<string, ServerMessage>;
  cooldowns: Map<string, number>;
  presenceTimer: NodeJS.Timeout | null;
  lastClientAt: number;
}

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const DEDUP_SIZE = 500;

export class HubError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class Hub {
  private live = new Map<string, LiveSession>();

  constructor(
    private readonly store: Store,
    private readonly config: Config,
    readonly catalog: ThemeCatalog,
    private readonly log: Logger,
    private readonly now: () => number = () => Date.now(),
  ) {}

  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------
  createSession(
    name: string,
    themeId: string | undefined,
    locale: 'de' | 'en' = 'de',
  ): { state: SessionState; ownerToken: string; ownerId: string } {
    if (this.store.countSessions() >= this.config.maxSessions) {
      throw new HubError(503, 'capacity', 'Server has reached its show limit. Please try again later.');
    }
    const theme = (themeId && this.catalog.get(themeId)) || this.catalog.themes[0];
    if (!theme) throw new HubError(500, 'no_theme', 'No themes installed');
    const now = this.now();
    const id = newId();
    const state = createInitialState(id, name, now, theme.id, newSeed());
    const ownerId = newId();
    state.controllers.push({ id: ownerId, name: 'Owner', role: 'owner', joinedAt: now });
    const templateActors = theme.presets[0]?.ambientActors ?? [];
    if (templateActors.length > 0) {
      state.ambient.enabled = true;
      state.ambient.actors = templateActors
        .filter((a) => theme.actors.some((x) => x.id === a && x.childSafe))
        .map((actorId) => ({ themeId: theme.id, actorId }));
    }
    // Starter stage: the preview shows something before any projector is paired.
    const ctx = {
      now,
      actor: { id: ownerId, name: 'Owner', role: 'owner' as const },
      catalog: this.catalog,
      newId,
      newSeed,
    };
    for (const s of theme.starterStage ?? []) createSurface(state, s.name[locale] || s.name.en, s.kind, ctx);
    // The room comes with one planned projector per side (a PC is connected to one of them later).
    planRoomOutputs(state, ctx);
    const ownerToken = newToken();
    this.store.tx(() => {
      this.store.insertSession(state, now);
      this.store.insertToken(hashSecret(ownerToken), id, 'owner', ownerId, now);
      this.issueCode(id, 'pair');
    });
    return { state, ownerToken, ownerId };
  }

  /** Loads a session into memory (or returns the cached one). */
  private load(sessionId: string): LiveSession | null {
    const cached = this.live.get(sessionId);
    if (cached) return cached;
    const state = this.store.loadSession(sessionId);
    if (!state) return null;
    pruneCues(state, this.now());
    const ls: LiveSession = {
      state,
      clients: new Set(),
      presence: { devices: {}, controllers: {} },
      dedup: new Map(),
      cooldowns: new Map(),
      presenceTimer: null,
      lastClientAt: this.now(),
    };
    this.live.set(sessionId, ls);
    return ls;
  }

  getState(sessionId: string): SessionState | null {
    return this.load(sessionId)?.state ?? null;
  }

  deleteSession(sessionId: string): void {
    const ls = this.live.get(sessionId);
    if (ls) {
      for (const c of ls.clients) {
        this.send(c, { type: 'error', code: 'session_deleted', message: 'This show was deleted.' });
        c.ws.close(4404, 'session deleted');
      }
      if (ls.presenceTimer) clearTimeout(ls.presenceTimer);
      this.live.delete(sessionId);
    }
    this.store.deleteSession(sessionId);
  }

  resolveToken(token: string): TokenRow | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    return this.store.findToken(hashSecret(token));
  }

  rotateOwner(row: TokenRow): string {
    const token = newToken();
    this.store.tx(() => {
      this.store.deleteToken(row.hash);
      this.store.insertToken(hashSecret(token), row.session_id, 'owner', row.subject_id, this.now());
    });
    // Other connections using the old owner token are closed.
    const ls = this.live.get(row.session_id);
    if (ls) {
      for (const c of ls.clients) {
        if (c.subjectId === row.subject_id) {
          this.send(c, { type: 'error', code: 'revoked', message: 'Owner key was rotated.' });
          c.ws.close(4401, 'revoked');
        }
      }
    }
    return token;
  }

  // -------------------------------------------------------------------------
  // Codes
  // -------------------------------------------------------------------------
  issueCode(sessionId: string, kind: 'pair' | 'invite'): { code: string; expiresAt: number } {
    const now = this.now();
    if (kind === 'pair') this.store.deleteCodes(sessionId, 'pair');
    else if (this.store.activeCodes(sessionId, 'invite', now).length >= 5) {
      throw new HubError(429, 'limit', 'Too many open invites');
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      const hash = hashSecret(`${kind}:${code}`);
      if (this.store.findCode(hash)) continue;
      const expiresAt = now + (kind === 'pair' ? this.config.pairingCodeTtlMs : this.config.inviteTtlMs);
      this.store.insertCode({
        hash,
        code,
        session_id: sessionId,
        kind,
        expires_at: expiresAt,
        uses_left: kind === 'pair' ? 50 : 1,
      });
      const ls = this.live.get(sessionId);
      if (ls) this.broadcastSnapshot(ls);
      return { code, expiresAt };
    }
    throw new HubError(500, 'code', 'Could not allocate a code');
  }

  private lookupCode(kind: 'pair' | 'invite', input: string) {
    const code = normalizeCode(input);
    if (!isValidCode(code)) return null;
    const row = this.store.findCode(hashSecret(`${kind}:${code}`));
    if (!row || row.expires_at <= this.now() || row.uses_left <= 0) return null;
    return row;
  }

  /** Device join request. Returns a pending token that grants nothing but waiting for approval. */
  requestPairing(
    codeInput: string,
    deviceName: string,
  ): { pendingToken: string; deviceId: string; sessionName: string } | null {
    const row = this.lookupCode('pair', codeInput);
    if (!row) return null;
    const ls = this.load(row.session_id);
    if (!ls) return null;
    const pending = ls.state.devices.filter((d) => d.status === 'pending').length;
    if (pending >= 10)
      throw new HubError(429, 'too_many_pending', 'Too many pending join requests for this show');
    if (ls.state.devices.length >= this.config.maxDevicesPerSession) {
      throw new HubError(409, 'device_limit', 'This show has reached its device limit');
    }
    const deviceId = newId();
    const token = newToken();
    const now = this.now();
    const next = structuredClone(ls.state);
    next.devices.push({ id: deviceId, name: deviceName, status: 'pending', outputId: null, joinedAt: now });
    next.revision++;
    this.store.tx(() => {
      this.store.decrementCode(row.hash);
      this.store.insertToken(hashSecret(token), row.session_id, 'pending', deviceId, now);
      this.store.saveSession(next, now);
    });
    ls.state = next;
    this.broadcastSnapshot(ls);
    return { pendingToken: token, deviceId, sessionName: ls.state.name };
  }

  /** Co-controller joins with an invite code. */
  redeemInvite(
    codeInput: string,
    name: string,
  ): { token: string; controllerId: string; sessionId: string } | null {
    const row = this.lookupCode('invite', codeInput);
    if (!row) return null;
    const ls = this.load(row.session_id);
    if (!ls) return null;
    if (ls.state.controllers.length >= 16) throw new HubError(409, 'limit', 'Too many controllers');
    const controllerId = newId();
    const token = newToken();
    const now = this.now();
    const next = structuredClone(ls.state);
    next.controllers.push({ id: controllerId, name, role: 'controller', joinedAt: now });
    next.revision++;
    this.store.tx(() => {
      this.store.deleteCode(row.hash);
      this.store.insertToken(hashSecret(token), row.session_id, 'controller', controllerId, now);
      this.store.saveSession(next, now);
    });
    ls.state = next;
    this.broadcastSnapshot(ls);
    return { token, controllerId, sessionId: row.session_id };
  }

  secrets(sessionId: string): ControllerSecrets {
    const now = this.now();
    const pair = this.store.activeCodes(sessionId, 'pair', now)[0];
    return {
      pairingCode: pair?.code ?? null,
      pairingExpiresAt: pair?.expires_at ?? null,
      invites: this.store
        .activeCodes(sessionId, 'invite', now)
        .map((c) => ({ code: c.code, expiresAt: c.expires_at })),
    };
  }

  // -------------------------------------------------------------------------
  // Clients
  // -------------------------------------------------------------------------
  attach(client: Client): boolean {
    const ls = this.load(client.sessionId);
    if (!ls) return false;
    // Device must still exist / controller must still be listed.
    if (client.role === 'device' || client.role === 'pending') {
      const d = ls.state.devices.find((x) => x.id === client.subjectId);
      if (!d) return false;
      if (client.role === 'pending' && d.status === 'approved') {
        ls.clients.add(client);
        this.completeApproval(ls, d.id);
        return true;
      }
    } else if (!ls.state.controllers.some((c) => c.id === client.subjectId)) {
      return false;
    }
    ls.clients.add(client);
    ls.lastClientAt = this.now();
    // Ended cues are never handed to (re)connecting clients.
    pruneCues(ls.state, this.now());
    this.markPresence(ls, client, true);
    if (client.role !== 'pending') this.sendSnapshot(ls, client);
    this.send(client, { type: 'presence', presence: ls.presence });
    this.store.touchSession(ls.state.id, this.now());
    return true;
  }

  detach(client: Client): void {
    const ls = this.live.get(client.sessionId);
    if (!ls) return;
    ls.clients.delete(client);
    ls.lastClientAt = this.now();
    const stillConnected = [...ls.clients].some((c) => c.subjectId === client.subjectId);
    if (!stillConnected) this.markPresence(ls, client, false);
  }

  private markPresence(ls: LiveSession, client: Client, online: boolean): void {
    const now = this.now();
    if (client.role === 'device' || client.role === 'pending') {
      const prev = ls.presence.devices[client.subjectId];
      ls.presence.devices[client.subjectId] = { online, lastSeen: now, telemetry: prev?.telemetry ?? null };
    } else {
      ls.presence.controllers[client.subjectId] = { online, lastSeen: now };
    }
    this.schedulePresence(ls);
  }

  private schedulePresence(ls: LiveSession): void {
    if (ls.presenceTimer) return;
    ls.presenceTimer = setTimeout(() => {
      ls.presenceTimer = null;
      for (const c of ls.clients) {
        if (c.role === 'owner' || c.role === 'controller')
          this.send(c, { type: 'presence', presence: ls.presence });
      }
    }, 500);
  }

  handleTelemetry(client: Client, t: Telemetry): void {
    if (client.role !== 'device') return;
    const ls = this.live.get(client.sessionId);
    if (!ls) return;
    ls.presence.devices[client.subjectId] = { online: true, lastSeen: this.now(), telemetry: t };
    this.schedulePresence(ls);
    const d = ls.state.devices.find((x) => x.id === client.subjectId);
    if (d?.outputId && t.width > 0 && t.height > 0) {
      const next = structuredClone(ls.state);
      if (applyReportedResolution(next, d.outputId, t.width, t.height))
        this.commit(ls, next, 'system', 'resolution reported');
    }
  }

  relayPreview(client: Client, outputId: string, profile: Profile | null, focus?: number): void {
    if (client.role !== 'owner' && client.role !== 'controller') return;
    const ls = this.live.get(client.sessionId);
    if (!ls || !ls.state.outputs.some((o) => o.id === outputId)) return;
    for (const c of ls.clients) {
      if (c.role !== 'device') continue;
      const d = ls.state.devices.find((x) => x.id === c.subjectId);
      if (d?.outputId === outputId) this.send(c, { type: 'preview', outputId, profile, focus });
    }
  }

  /**
   * WebRTC signalling (live camera): a controller talks to a device by its device id, a device
   * answers to the controller's address; nothing leaves the show.
   */
  relayRtc(client: Client, to: string, data: RtcData): void {
    const ls = this.live.get(client.sessionId);
    if (!ls) return;
    const from = `${client.role === 'device' ? 'd' : 'c'}:${client.subjectId}:${client.clientId}`;
    for (const c of ls.clients) {
      if (client.role === 'owner' || client.role === 'controller') {
        if (c.role === 'device' && c.subjectId === to) this.send(c, { type: 'rtc', from, data });
      } else if (client.role === 'device') {
        if ((c.role === 'owner' || c.role === 'controller') && `c:${c.subjectId}:${c.clientId}` === to)
          this.send(c, { type: 'rtc', from, data });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------
  execute(client: Client, cmdId: string, cmd: Command): ServerMessage {
    const ls = this.live.get(client.sessionId);
    if (!ls) return { type: 'nack', id: cmdId, code: 'no_session', message: 'Session not loaded' };
    const cached = ls.dedup.get(cmdId);
    if (cached) return cached;
    const result = this.executeInner(ls, client, cmdId, cmd);
    ls.dedup.set(cmdId, result);
    if (ls.dedup.size > DEDUP_SIZE) ls.dedup.delete(ls.dedup.keys().next().value as string);
    return result;
  }

  private executeInner(ls: LiveSession, client: Client, cmdId: string, cmd: Command): ServerMessage {
    if (client.role !== 'owner' && client.role !== 'controller') {
      return { type: 'nack', id: cmdId, code: 'forbidden', message: 'Not a controller' };
    }
    const controller = ls.state.controllers.find((c) => c.id === client.subjectId);
    if (!controller) return { type: 'nack', id: cmdId, code: 'forbidden', message: 'Unknown controller' };
    const now = this.now();

    if (cmd.t === 'effect.fire') {
      const theme = this.catalog.get(cmd.themeId);
      const eff = theme?.effects.find((e) => e.id === cmd.effectId);
      if (eff) {
        for (const sid of cmd.surfaceIds) {
          const key = `${sid}:${cmd.themeId}:${cmd.effectId}`;
          const last = ls.cooldowns.get(key) ?? 0;
          if (now - last < eff.cooldownMs) {
            return { type: 'nack', id: cmdId, code: 'cooldown', message: 'Effect is cooling down' };
          }
        }
        for (const sid of cmd.surfaceIds) ls.cooldowns.set(`${sid}:${cmd.themeId}:${cmd.effectId}`, now);
      }
    }

    const rtts = Object.entries(ls.presence.devices)
      .filter(([, p]) => p.online && p.telemetry)
      .map(([, p]) => p.telemetry!.rttMs);
    try {
      const r = applyCommand(ls.state, cmd, {
        now,
        actor: { id: controller.id, name: controller.name, role: controller.role },
        catalog: this.catalog,
        newId,
        newSeed,
        leadMs: cueLeadMs(rtts),
      });
      if (r.changed) {
        const next = r.state;
        this.commit(ls, next, controller.name, r.summary);
      }
      if (r.approvedDevice) this.completeApproval(ls, r.approvedDevice);
      if (r.revokeDevice) this.revokeSubject(ls, r.revokeDevice, 'rejected');
      if (r.revokeController) this.revokeSubject(ls, r.revokeController, 'revoked');
      if (r.identify) {
        const d = ls.state.devices.find((x) => x.id === r.identify!.deviceId);
        for (const c of ls.clients) {
          if (c.subjectId === r.identify.deviceId) {
            this.send(c, {
              type: 'identify',
              deviceId: c.subjectId,
              label: d?.name ?? '',
              until: now + 8000,
            });
          }
        }
      }
      return { type: 'ack', id: cmdId, revision: ls.state.revision };
    } catch (e) {
      if (e instanceof CommandError) return { type: 'nack', id: cmdId, code: e.code, message: e.message };
      this.log.error({ err: e }, 'command failed');
      return { type: 'nack', id: cmdId, code: 'internal', message: 'Internal error' };
    }
  }

  private commit(ls: LiveSession, next: SessionState, actor: string, summary: string): void {
    next.revision = ls.state.revision + 1;
    const now = this.now();
    this.store.tx(() => {
      this.store.saveSession(next, now);
      if (actor !== 'system') this.store.audit(next.id, now, actor, summary);
    });
    if (next.revision % 50 === 0) this.store.pruneAudit(next.id);
    ls.state = next;
    this.broadcastSnapshot(ls);
  }

  /** Issues the device token to a pending client once its device was approved. */
  private completeApproval(ls: LiveSession, deviceId: string): void {
    const pendingClients = [...ls.clients].filter((c) => c.subjectId === deviceId && c.role === 'pending');
    if (pendingClients.length === 0) return; // client will receive token when it reconnects with its pending token
    const token = newToken();
    this.store.tx(() => {
      this.store.deleteTokensForSubject(ls.state.id, deviceId);
      this.store.insertToken(hashSecret(token), ls.state.id, 'device', deviceId, this.now());
    });
    for (const c of pendingClients) {
      this.send(c, { type: 'approved', deviceToken: token, deviceId });
      c.role = 'device';
      this.markPresence(ls, c, true);
      this.sendSnapshot(ls, c);
    }
  }

  /** Re-issues a device token for a pending client that reconnects after approval. */
  upgradePending(row: TokenRow): string | null {
    const ls = this.load(row.session_id);
    const d = ls?.state.devices.find((x) => x.id === row.subject_id);
    if (!d || d.status !== 'approved') return null;
    const token = newToken();
    this.store.tx(() => {
      this.store.deleteTokensForSubject(row.session_id, row.subject_id);
      this.store.insertToken(hashSecret(token), row.session_id, 'device', row.subject_id, this.now());
    });
    return token;
  }

  private revokeSubject(ls: LiveSession, subjectId: string, kind: 'rejected' | 'revoked'): void {
    this.store.deleteTokensForSubject(ls.state.id, subjectId);
    delete ls.presence.devices[subjectId];
    delete ls.presence.controllers[subjectId];
    for (const c of [...ls.clients]) {
      if (c.subjectId !== subjectId) continue;
      if (kind === 'rejected' && c.role === 'pending') this.send(c, { type: 'rejected' });
      else this.send(c, { type: 'error', code: 'revoked', message: 'Access was revoked.' });
      c.ws.close(4401, kind);
      ls.clients.delete(c);
    }
    this.schedulePresence(ls);
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------
  send(client: Client, msg: ServerMessage): void {
    if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
  }

  private sendSnapshot(ls: LiveSession, client: Client): void {
    if (client.role === 'pending') return;
    const isController = client.role === 'owner' || client.role === 'controller';
    this.send(client, {
      type: 'snapshot',
      state: ls.state,
      ...(isController ? { secrets: this.secrets(ls.state.id) } : {}),
    });
  }

  broadcastSnapshot(ls: LiveSession): void {
    const secrets = this.secrets(ls.state.id);
    const forController = JSON.stringify({
      type: 'snapshot',
      state: ls.state,
      secrets,
    } satisfies ServerMessage);
    const forDevice = JSON.stringify({ type: 'snapshot', state: ls.state } satisfies ServerMessage);
    for (const c of ls.clients) {
      if (c.ws.readyState !== 1 || c.role === 'pending') continue;
      c.ws.send(c.role === 'device' ? forDevice : forController);
    }
  }

  // -------------------------------------------------------------------------
  // Auto mode: time schedule (presets / boost / blackout at local clock times)
  // -------------------------------------------------------------------------
  scheduleTick(): void {
    const now = this.now();
    for (const ls of this.live.values()) {
      const sch = ls.state.schedule;
      if (!sch?.enabled || sch.entries.length === 0) continue;
      const today = localClock(now, sch.timezone);
      const yesterday = localClock(now - 86_400_000, sch.timezone);
      if (!today || !yesterday) continue;
      const sorted = [...sch.entries].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      let entry = [...sorted].reverse().find((e) => e.at <= today.hm);
      let key: string;
      if (entry) key = `${today.date}|${entry.id}`;
      else {
        // Before the first entry of the day: the last entry of yesterday is still active.
        entry = sorted[sorted.length - 1]!;
        key = `${yesterday.date}|${entry.id}`;
      }
      if (sch.lastApplied === key) continue;
      try {
        const ctx = {
          now,
          actor: { id: 'schedule', name: 'Zeitplan', role: 'owner' as const },
          catalog: this.catalog,
          newId,
          newSeed,
          leadMs: 300,
        };
        let next = ls.state;
        const parts: string[] = [];
        if (entry.themeId && entry.presetId && this.catalog.get(entry.themeId)) {
          next = applyCommand(
            next,
            { t: 'preset.apply', themeId: entry.themeId, presetId: entry.presetId },
            ctx,
          ).state;
          parts.push(`preset ${entry.presetId}`);
        }
        if (entry.blackout !== null) {
          next = applyCommand(next, { t: 'session.blackoutAll', on: entry.blackout }, ctx).state;
          parts.push(entry.blackout ? 'blackout' : 'resume');
        }
        next = structuredClone(next);
        if (entry.boost !== null) {
          next.boost = entry.boost;
          parts.push(`boost ${Math.round(entry.boost * 100)}%`);
        }
        next.schedule = { ...sch, lastApplied: key };
        this.commit(ls, next, 'Zeitplan', `${entry.at} ${parts.join(', ')}`);
      } catch (e) {
        this.log.warn({ err: e, session: ls.state.id }, 'schedule entry failed');
        const next = structuredClone(ls.state);
        next.schedule = { ...sch, lastApplied: key };
        this.commit(ls, next, 'system', 'schedule skipped');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Maintenance
  // -------------------------------------------------------------------------
  sweep(): void {
    const now = this.now();
    for (const [id, ls] of this.live) {
      if (ls.clients.size === 0 && now - ls.lastClientAt > 10 * 60_000) {
        if (ls.presenceTimer) clearTimeout(ls.presenceTimer);
        this.live.delete(id);
      }
    }
    this.store.purgeExpiredCodes(now);
    if (this.config.sessionTtlDays > 0) {
      const n = this.store.deleteInactiveSessions(now - this.config.sessionTtlDays * 86400_000);
      if (n > 0) this.log.info({ n }, 'expired sessions deleted');
    }
  }

  allClients(): Client[] {
    return [...this.live.values()].flatMap((ls) => [...ls.clients]);
  }

  importState(sessionId: string, data: Partial<SessionState>, actor: string): void {
    const ls = this.load(sessionId);
    if (!ls) throw new HubError(404, 'not_found', 'Show not found');
    const next = structuredClone(ls.state);
    if (data.surfaces) next.surfaces = data.surfaces;
    if (data.outputs) {
      // Keep existing output ids so paired devices stay bound; replace profiles by name match.
      for (const imported of data.outputs) {
        const existing = next.outputs.find((o) => o.id === imported.id || o.name === imported.name);
        if (existing) {
          existing.profiles = imported.profiles;
          existing.activeProfileId = imported.activeProfileId;
          existing.failover = imported.failover;
        }
      }
    }
    if (data.playlists) next.playlists = data.playlists;
    if (data.ambient) next.ambient = data.ambient;
    if (typeof data.kidsSafe === 'boolean') next.kidsSafe = data.kidsSafe;
    if (data.defaultThemeId && this.catalog.get(data.defaultThemeId))
      next.defaultThemeId = data.defaultThemeId;
    next.cues = [];
    this.commit(ls, next, actor, 'import');
  }

  audit(sessionId: string) {
    return this.store.recentAudit(sessionId);
  }
}

/** Local date (YYYY-MM-DD) and time (HH:MM) in an IANA time zone; null for invalid zones. */
export function localClock(ms: number, timeZone: string): { date: string; hm: string } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(ms));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hm: `${get('hour')}:${get('minute')}` };
  } catch {
    return null;
  }
}
