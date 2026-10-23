import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SessionState } from '@spectrastage/shared';

export type TokenKind = 'owner' | 'controller' | 'device' | 'pending';
export interface TokenRow {
  hash: string;
  session_id: string;
  kind: TokenKind;
  subject_id: string;
}
export type CodeKind = 'pair' | 'invite';
export interface CodeRow {
  hash: string;
  code: string;
  session_id: string;
  kind: CodeKind;
  expires_at: number;
  uses_left: number;
}

const MIGRATIONS: string[] = [
  `CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     state_json TEXT NOT NULL,
     revision INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     last_active_at INTEGER NOT NULL
   );
   CREATE TABLE tokens (
     hash TEXT PRIMARY KEY,
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     subject_id TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX tokens_session ON tokens(session_id);
   CREATE INDEX tokens_subject ON tokens(subject_id);
   CREATE TABLE codes (
     hash TEXT PRIMARY KEY,
     code TEXT NOT NULL,
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     uses_left INTEGER NOT NULL
   );
   CREATE INDEX codes_session ON codes(session_id);
   CREATE TABLE audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     at INTEGER NOT NULL,
     actor TEXT NOT NULL,
     summary TEXT NOT NULL
   );
   CREATE INDEX audit_session ON audit(session_id, at);`,
];

export class Store {
  readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = this.db.prepare('SELECT version FROM schema_version').get() as
      { version: number } | undefined;
    let version = row?.version ?? 0;
    if (!row) this.db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
    while (version < MIGRATIONS.length) {
      const sql = MIGRATIONS[version] as string;
      this.db.transaction(() => {
        this.db.exec(sql);
        this.db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
      })();
      version++;
    }
  }

  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  countSessions(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
  }

  insertSession(state: SessionState, now: number): void {
    this.db
      .prepare(
        'INSERT INTO sessions (id, state_json, revision, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(state.id, JSON.stringify(state), state.revision, now, now, now);
  }

  saveSession(state: SessionState, now: number): void {
    this.db
      .prepare(
        'UPDATE sessions SET state_json = ?, revision = ?, updated_at = ?, last_active_at = ? WHERE id = ?',
      )
      .run(JSON.stringify(state), state.revision, now, now, state.id);
  }

  touchSession(id: string, now: number): void {
    this.db.prepare('UPDATE sessions SET last_active_at = ? WHERE id = ?').run(now, id);
  }

  loadSession(id: string): SessionState | null {
    const row = this.db.prepare('SELECT state_json FROM sessions WHERE id = ?').get(id) as
      { state_json: string } | undefined;
    return row ? (JSON.parse(row.state_json) as SessionState) : null;
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  deleteInactiveSessions(olderThan: number): number {
    return this.db.prepare('DELETE FROM sessions WHERE last_active_at < ?').run(olderThan).changes;
  }

  insertToken(hash: string, sessionId: string, kind: TokenKind, subjectId: string, now: number): void {
    this.db
      .prepare('INSERT INTO tokens (hash, session_id, kind, subject_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(hash, sessionId, kind, subjectId, now);
  }

  findToken(hash: string): TokenRow | null {
    return (
      (this.db.prepare('SELECT hash, session_id, kind, subject_id FROM tokens WHERE hash = ?').get(hash) as
        TokenRow | undefined) ?? null
    );
  }

  deleteTokensForSubject(sessionId: string, subjectId: string): void {
    this.db.prepare('DELETE FROM tokens WHERE session_id = ? AND subject_id = ?').run(sessionId, subjectId);
  }

  deleteToken(hash: string): void {
    this.db.prepare('DELETE FROM tokens WHERE hash = ?').run(hash);
  }

  insertCode(row: CodeRow): void {
    this.db
      .prepare(
        'INSERT INTO codes (hash, code, session_id, kind, expires_at, uses_left) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(row.hash, row.code, row.session_id, row.kind, row.expires_at, row.uses_left);
  }

  findCode(hash: string): CodeRow | null {
    return (this.db.prepare('SELECT * FROM codes WHERE hash = ?').get(hash) as CodeRow | undefined) ?? null;
  }

  deleteCodes(sessionId: string, kind: CodeKind): void {
    this.db.prepare('DELETE FROM codes WHERE session_id = ? AND kind = ?').run(sessionId, kind);
  }

  deleteCode(hash: string): void {
    this.db.prepare('DELETE FROM codes WHERE hash = ?').run(hash);
  }

  decrementCode(hash: string): void {
    this.db.prepare('UPDATE codes SET uses_left = uses_left - 1 WHERE hash = ?').run(hash);
  }

  activeCodes(sessionId: string, kind: CodeKind, now: number): CodeRow[] {
    return this.db
      .prepare(
        'SELECT * FROM codes WHERE session_id = ? AND kind = ? AND expires_at > ? AND uses_left > 0 ORDER BY expires_at DESC',
      )
      .all(sessionId, kind, now) as CodeRow[];
  }

  purgeExpiredCodes(now: number): void {
    this.db.prepare('DELETE FROM codes WHERE expires_at <= ? OR uses_left <= 0').run(now);
  }

  audit(sessionId: string, at: number, actor: string, summary: string): void {
    this.db
      .prepare('INSERT INTO audit (session_id, at, actor, summary) VALUES (?, ?, ?, ?)')
      .run(sessionId, at, actor, summary.slice(0, 200));
  }

  pruneAudit(sessionId: string, keep = 500): void {
    this.db
      .prepare(
        'DELETE FROM audit WHERE session_id = ? AND id NOT IN (SELECT id FROM audit WHERE session_id = ? ORDER BY id DESC LIMIT ?)',
      )
      .run(sessionId, sessionId, keep);
  }

  recentAudit(sessionId: string, limit = 50): { at: number; actor: string; summary: string }[] {
    return this.db
      .prepare('SELECT at, actor, summary FROM audit WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionId, limit) as { at: number; actor: string; summary: string }[];
  }

  close(): void {
    this.db.close();
  }
}
