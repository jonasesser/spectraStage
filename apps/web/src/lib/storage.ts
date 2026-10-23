/** localStorage wrapper that never throws (private mode, blocked storage). */
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  getJson<T>(key: string): T | null {
    const raw = storage.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  setJson(key: string, value: unknown): void {
    storage.set(key, JSON.stringify(value));
  },
};

export const KEYS = {
  controllerToken: 'ss.controller.token',
  controllerRole: 'ss.controller.role',
  locale: 'ss.locale',
  displayToken: (slot: string) => `ss.display.${slot}.token`,
  displayPending: (slot: string) => `ss.display.${slot}.pending`,
  displayName: (slot: string) => `ss.display.${slot}.name`,
  displaySnapshot: (slot: string) => `ss.display.${slot}.snapshot`,
  clientId: 'ss.clientId',
};

export function clientId(): string {
  let id = storage.get(KEYS.clientId);
  if (!id) {
    id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    storage.set(KEYS.clientId, id);
  }
  return id;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
