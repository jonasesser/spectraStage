import { KEYS, storage } from '../lib/storage.ts';

/** A projector connection this browser has been approved for (one per show/device). */
export interface SavedConnection {
  id: string;
  /** Device name of this projector ("Garage"). */
  name: string;
  /** Show name, filled in once a snapshot arrived. */
  showName?: string;
  token: string;
  deviceId?: string;
  savedAt: number;
  lastUsed: number;
}

const LIST_KEY = 'ss.display.connections';
const activeKey = (slot: string) => `ss.display.${slot}.active`;

export function listConnections(): SavedConnection[] {
  const list = storage.getJson<SavedConnection[]>(LIST_KEY);
  return Array.isArray(list) ? list.filter((c) => c && typeof c.token === 'string') : [];
}

function writeList(list: SavedConnection[]): void {
  storage.setJson(LIST_KEY, list);
}

/** Adds or updates (matched by token) a connection and returns its id. */
export function upsertConnection(c: Omit<SavedConnection, 'id' | 'savedAt' | 'lastUsed'>): string {
  const list = listConnections();
  const now = Date.now();
  const existing = list.find((x) => x.token === c.token);
  if (existing) {
    Object.assign(existing, c, { lastUsed: now });
    writeList(list);
    return existing.id;
  }
  const id = Math.random().toString(36).slice(2, 10) + now.toString(36);
  writeList([{ ...c, id, savedAt: now, lastUsed: now }, ...list]);
  return id;
}

export function patchConnectionByToken(token: string, patch: Partial<SavedConnection>): void {
  const list = listConnections();
  const c = list.find((x) => x.token === token);
  if (!c) return;
  const changed = Object.entries(patch).some(([k, v]) => c[k as keyof SavedConnection] !== v);
  if (!changed) return;
  Object.assign(c, patch);
  writeList(list);
}

export function removeConnection(id: string): void {
  writeList(listConnections().filter((c) => c.id !== id));
}

export function removeConnectionByToken(token: string): void {
  writeList(listConnections().filter((c) => c.token !== token));
}

/** Makes a saved connection the active one of this slot (what the projection connects with). */
export function activateConnection(slot: string, c: SavedConnection): void {
  const prev = storage.get(KEYS.displayToken(slot));
  if (prev !== c.token) storage.remove(KEYS.displaySnapshot(slot));
  storage.set(KEYS.displayToken(slot), c.token);
  storage.set(KEYS.displayName(slot), c.name);
  if (c.deviceId) storage.set(`${KEYS.displayToken(slot)}.id`, c.deviceId);
  else storage.remove(`${KEYS.displayToken(slot)}.id`);
  storage.remove(KEYS.displayPending(slot));
  patchConnectionByToken(c.token, { lastUsed: Date.now() });
  markActive(slot);
}

/** Remembers for this tab that the slot is in use, so a reload (F5, GPU recovery) resumes directly. */
export function markActive(slot: string): void {
  try {
    sessionStorage.setItem(activeKey(slot), '1');
  } catch {
    /* ignore */
  }
}

export function clearActive(slot: string): void {
  try {
    sessionStorage.removeItem(activeKey(slot));
  } catch {
    /* ignore */
  }
}

/** True when this page load is a reload of a tab that was already projecting / waiting. */
export function shouldResume(slot: string): boolean {
  let active = false;
  try {
    active = sessionStorage.getItem(activeKey(slot)) === '1';
  } catch {
    /* ignore */
  }
  if (!active) return false;
  const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === 'reload';
}

/** Moves a connection stored by an older version (one token per slot) into the list. */
export function migrateLegacy(slot: string): void {
  const token = storage.get(KEYS.displayToken(slot));
  if (!token || listConnections().some((c) => c.token === token)) return;
  upsertConnection({
    token,
    name: storage.get(KEYS.displayName(slot)) ?? 'Beamer',
    deviceId: storage.get(`${KEYS.displayToken(slot)}.id`) ?? undefined,
    showName: storage.getJson<{ name?: string }>(KEYS.displaySnapshot(slot))?.name,
  });
}
