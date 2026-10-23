import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Command, ControllerSecrets, Presence, Role, SessionState } from '@spectrastage/shared';
import { Connection, type CommandResult, type ConnStatus } from '../lib/connection.ts';

export interface ControllerSnapshot {
  status: ConnStatus;
  state: SessionState | null;
  secrets: ControllerSecrets | null;
  presence: Presence;
  role: Role | null;
  subjectId: string | null;
  toast: { id: number; text: string; kind: 'info' | 'error' } | null;
}

export class ControllerStore {
  conn: Connection;
  private snap: ControllerSnapshot = {
    status: 'connecting',
    state: null,
    secrets: null,
    presence: { devices: {}, controllers: {} },
    role: null,
    subjectId: null,
    toast: null,
  };
  private listeners = new Set<() => void>();
  private toastId = 0;

  constructor(
    public token: string,
    onAuthError: (code: string) => void,
  ) {
    this.conn = new Connection(token, {
      onStatus: (status) => this.set({ status }),
      onWelcome: (m) => this.set({ role: m.role, subjectId: m.subjectId }),
      onSnapshot: (state, secrets) => this.set({ state, secrets: secrets ?? this.snap.secrets }),
      onPresence: (presence) => this.set({ presence }),
      onAuthError: (code) => onAuthError(code),
    });
  }

  start(): void {
    this.conn.start();
  }
  stop(): void {
    this.conn.stop();
  }

  private set(p: Partial<ControllerSnapshot>): void {
    this.snap = { ...this.snap, ...p };
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  get = (): ControllerSnapshot => this.snap;

  toast(text: string, kind: 'info' | 'error' = 'info'): void {
    const id = ++this.toastId;
    this.set({ toast: { id, text, kind } });
    window.setTimeout(
      () => {
        if (this.snap.toast?.id === id) this.set({ toast: null });
      },
      kind === 'error' ? 4500 : 2200,
    );
  }

  /** Sends a command and shows errors as toast. */
  async send(cmd: Command, errorText?: (r: CommandResult) => string): Promise<boolean> {
    const r = await this.conn.command(cmd);
    if (!r.ok) {
      const msg =
        errorText?.(r) ??
        (r.code === 'offline'
          ? 'Offline – Befehl nicht gesendet / not sent'
          : r.code === 'cooldown'
            ? '⏳'
            : (r.message ?? r.code ?? 'Error'));
      this.toast(msg, 'error');
    }
    return r.ok;
  }
}

export const StoreCtx = createContext<ControllerStore | null>(null);

export function useStore(): ControllerStore {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('no store');
  return s;
}

export function useSnap(): ControllerSnapshot {
  const s = useStore();
  return useSyncExternalStore(s.subscribe, s.get);
}

/** Like useSnap but asserts the state is loaded. */
export function useShow(): ControllerSnapshot & { state: SessionState } {
  const snap = useSnap();
  if (!snap.state) throw new Error('state not loaded');
  return snap as ControllerSnapshot & { state: SessionState };
}
