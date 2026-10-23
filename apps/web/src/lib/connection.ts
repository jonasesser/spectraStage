/**
 * Realtime connection used by controllers and displays.
 * - Authenticates in the first message (token never in the URL)
 * - Reconnects with exponential backoff + jitter (0.5 s … 30 s)
 * - Clock sync via ping/pong; dead-socket detection
 * - Commands get ids; unacknowledged ones are resent with the same id after reconnect
 *   (the server deduplicates), new commands are refused while offline (no hidden queue).
 */
import { ServerClock } from '@spectrastage/engine';
import {
  PROTOCOL_VERSION,
  type Command,
  type ControllerSecrets,
  type Presence,
  type Profile,
  type ServerMessage,
  type SessionState,
  type Telemetry,
} from '@spectrastage/shared';
import { clientId, uuid } from './storage.ts';

export type ConnStatus = 'connecting' | 'online' | 'offline';

export interface CommandResult {
  ok: boolean;
  code?: string;
  message?: string;
}

export interface ConnectionHandlers {
  onStatus?(status: ConnStatus): void;
  onWelcome?(m: Extract<ServerMessage, { type: 'welcome' }>): void;
  onSnapshot?(state: SessionState, secrets: ControllerSecrets | undefined): void;
  onPresence?(p: Presence): void;
  onIdentify?(label: string, until: number): void;
  onPreview?(outputId: string, profile: Profile | null, focus?: number): void;
  onApproved?(deviceToken: string, deviceId: string): void;
  onRejected?(): void;
  /** Fatal auth errors: the token is invalid → caller should forget it. */
  onAuthError?(code: string, message: string): void;
}

interface PendingCmd {
  id: string;
  cmd: Command;
  resolve: (r: CommandResult) => void;
  sentAt: number;
}

export class Connection {
  readonly clock = new ServerClock();
  status: ConnStatus = 'connecting';
  state: SessionState | null = null;
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private reconnectTimer = 0;
  private pingTimer = 0;
  private lastMessageAt = 0;
  private pending = new Map<string, PendingCmd>();
  private welcomed = false;

  constructor(
    private token: string,
    private readonly handlers: ConnectionHandlers,
  ) {}

  setToken(token: string): void {
    this.token = token;
  }

  start(): void {
    this.stopped = false;
    this.connect();
    window.addEventListener('online', this.onBrowserOnline);
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener('online', this.onBrowserOnline);
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.pingTimer);
    this.ws?.close(1000, 'bye');
    this.ws = null;
  }

  /** Browser says we are back online: retry immediately (it is only a hint). */
  private onBrowserOnline = () => {
    if (this.status !== 'online') {
      window.clearTimeout(this.reconnectTimer);
      this.attempt = 0;
      this.connect();
    }
  };

  private setStatus(s: ConnStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.handlers.onStatus?.(s);
  }

  private connect(): void {
    if (this.stopped) return;
    this.ws?.close();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}//${location.host}/ws`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.welcomed = false;
    if (this.status !== 'offline') this.setStatus('connecting');
    ws.onopen = () => {
      this.lastMessageAt = Date.now();
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          token: this.token,
          clientId: clientId(),
          lastRevision: this.state?.revision,
        }),
      );
      // Fast initial clock sync burst.
      for (let i = 0; i < 5; i++) window.setTimeout(() => this.ping(), 150 * i);
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        if (Date.now() - this.lastMessageAt > 30_000) {
          ws.close(4000, 'stale');
          return;
        }
        this.ping();
      }, 5000);
    };
    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      window.clearInterval(this.pingTimer);
      this.ws = null;
      if ([4401, 4404, 4426].includes(ev.code)) {
        this.setStatus('offline');
        if (ev.code === 4426) this.scheduleReconnect(30_000);
        return; // auth errors are handled via onAuthError
      }
      this.setStatus('offline');
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* close follows */
    };
  }

  private scheduleReconnect(minDelay = 0): void {
    if (this.stopped) return;
    window.clearTimeout(this.reconnectTimer);
    const base = Math.min(30_000, 500 * 2 ** this.attempt);
    const delay = Math.max(minDelay, base * (0.5 + Math.random()));
    this.attempt++;
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private ping(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ping', t: this.clock.localNow() }));
    }
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        this.welcomed = true;
        this.attempt = 0;
        this.setStatus('online');
        this.handlers.onWelcome?.(msg);
        // Resend unacknowledged commands with their original ids (server deduplicates).
        for (const p of this.pending.values())
          this.ws?.send(JSON.stringify({ type: 'cmd', id: p.id, cmd: p.cmd }));
        return;
      case 'pong':
        this.clock.addSample(msg.t, msg.serverTime);
        return;
      case 'snapshot':
        if (this.state && msg.state.id === this.state.id && msg.state.revision < this.state.revision) return;
        this.state = msg.state;
        this.handlers.onSnapshot?.(msg.state, msg.secrets);
        return;
      case 'presence':
        this.handlers.onPresence?.(msg.presence);
        return;
      case 'ack':
      case 'nack': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        p.resolve(msg.type === 'ack' ? { ok: true } : { ok: false, code: msg.code, message: msg.message });
        return;
      }
      case 'identify':
        this.handlers.onIdentify?.(msg.label, msg.until);
        return;
      case 'preview':
        this.handlers.onPreview?.(msg.outputId, msg.profile, msg.focus);
        return;
      case 'approved':
        this.token = msg.deviceToken;
        this.handlers.onApproved?.(msg.deviceToken, msg.deviceId);
        return;
      case 'rejected':
        this.handlers.onRejected?.();
        return;
      case 'error':
        if (msg.code === 'unauthorized' || msg.code === 'revoked' || msg.code === 'session_deleted') {
          this.handlers.onAuthError?.(msg.code, msg.message);
        }
        return;
    }
  }

  get online(): boolean {
    return this.status === 'online' && this.welcomed;
  }

  /** Sends a command. Refused immediately while offline – never pretends success. */
  command(cmd: Command, timeoutMs = 8000): Promise<CommandResult> {
    if (!this.online || !this.ws)
      return Promise.resolve({ ok: false, code: 'offline', message: 'Not connected' });
    const id = uuid();
    return new Promise((resolve) => {
      const entry: PendingCmd = { id, cmd, resolve, sentAt: Date.now() };
      this.pending.set(id, entry);
      this.ws!.send(JSON.stringify({ type: 'cmd', id, cmd }));
      window.setTimeout(() => {
        if (this.pending.has(id) && this.online) {
          // Still connected but no answer: report as unknown; it may still be applied.
          this.pending.delete(id);
          resolve({ ok: false, code: 'timeout', message: 'No answer from server' });
        }
      }, timeoutMs);
    });
  }

  sendTelemetry(t: Telemetry): void {
    if (this.online) this.ws?.send(JSON.stringify({ type: 'telemetry', telemetry: t }));
  }

  sendPreview(outputId: string, profile: Profile | null, focus?: number): void {
    if (this.online) this.ws?.send(JSON.stringify({ type: 'preview', outputId, profile, focus }));
  }
}
