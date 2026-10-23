import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { Output, Presence, SessionState } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-title">
          <h2>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label>
      <span className="row between">
        <span>{label}</span>
        <span className="num" style={{ color: 'var(--ink)' }}>
          {format ? format(value) : value}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export type Health = { level: 'ok' | 'warn' | 'bad' | 'off'; reasons: string[] };

export function outputHealth(output: Output, state: SessionState, presence: Presence, L: Tr): Health {
  const device = state.devices.find((d) => d.outputId === output.id && d.status === 'approved');
  if (!device) return { level: 'off', reasons: [L('No projector PC assigned', 'Kein Beamer-PC zugeordnet')] };
  const p = presence.devices[device.id];
  if (!p?.online) return { level: 'bad', reasons: [L('Projector PC offline', 'Beamer-PC offline')] };
  const reasons: string[] = [];
  const t = p.telemetry;
  if (output.resolutionMismatch)
    reasons.push(L('Resolution changed – output is black', 'Auflösung geändert – Ausgang ist schwarz'));
  if (t) {
    if (!t.calibrationOk && !output.resolutionMismatch)
      reasons.push(L('Calibration invalid', 'Kalibrierung ungültig'));
    if (t.rttMs > 250 || t.jitterMs > 60)
      reasons.push(L('Slow connection – sync may lag', 'Langsame Verbindung – Sync kann hängen'));
    if (t.fps > 0 && t.fps < 40) reasons.push(L('Low frame rate', 'Niedrige Bildrate'));
    if (t.localBlackout) reasons.push(L('Local blackout active (key B)', 'Lokaler Blackout aktiv (Taste B)'));
    if (!t.audioUnlocked)
      reasons.push(
        L(
          'Sound not enabled – click once on the projector PC',
          'Ton nicht aktiv – einmal am Beamer-PC klicken',
        ),
      );
  }
  const severe = output.resolutionMismatch || (t && !t.calibrationOk);
  return { level: severe ? 'bad' : reasons.length > 0 ? 'warn' : 'ok', reasons };
}

export function Light({ level, title }: { level: Health['level']; title?: string }) {
  return <span className={`light ${level}`} title={title} aria-label={title} role="img" />;
}

/** Surface selection shared between Live and Scenes tabs. */
export interface Selection {
  surfaceIds: string[];
  setSurfaceIds: (ids: string[]) => void;
}
export const SelectionCtx = createContext<Selection>({ surfaceIds: [], setSurfaceIds: () => {} });
export function useSelection(state: SessionState): {
  ids: string[];
  all: boolean;
  set: (ids: string[]) => void;
} {
  const sel = useContext(SelectionCtx);
  const valid = sel.surfaceIds.filter((id) => state.surfaces.some((s) => s.id === id));
  const ids = valid.length > 0 ? valid : state.surfaces.map((s) => s.id);
  return { ids, all: valid.length === 0 || valid.length === state.surfaces.length, set: sel.setSurfaceIds };
}

export function kindColor(kind: string): string {
  return kind === 'floor' ? 'var(--floor)' : kind === 'other' ? 'var(--other)' : 'var(--wall)';
}

export function kindLabel(kind: string, L: Tr): string {
  return kind === 'floor'
    ? L('Floor', 'Boden')
    : kind === 'other'
      ? L('Other', 'Sonstiges')
      : L('Wall', 'Wand');
}

export function SurfacePicker({ state, L }: { state: SessionState; L: Tr }) {
  const sel = useSelection(state);
  const ctx = useContext(SelectionCtx);
  const toggle = (id: string) => {
    const cur = ctx.surfaceIds.filter((x) => state.surfaces.some((s) => s.id === x));
    ctx.setSurfaceIds(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  if (state.surfaces.length === 0) return null;
  return (
    <div className="row" role="group" aria-label={L('Target surfaces', 'Ziel-Flächen')}>
      <button className={`chip${sel.all ? ' on' : ''}`} onClick={() => ctx.setSurfaceIds([])}>
        {L('All surfaces', 'Alle Flächen')}
      </button>
      {state.surfaces.map((s) => {
        const on = !sel.all && sel.ids.includes(s.id);
        return (
          <button
            key={s.id}
            className={`chip${on ? ' on' : ''}`}
            onClick={() => toggle(s.id)}
            aria-pressed={on}
          >
            <span className="dot" style={{ background: kindColor(s.kind) }} />
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

export function download(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickJsonFile(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return reject(new Error('no file'));
      if (f.size > 2_000_000) return reject(new Error('file too large'));
      f.text()
        .then((t) => resolve(JSON.parse(t)))
        .catch(reject);
    };
    input.click();
  });
}
