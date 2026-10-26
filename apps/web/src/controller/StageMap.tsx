import { useEffect, useMemo, useRef, useState } from 'react';
import { catalog } from '@spectrastage/catalog/manifests';
import {
  activeProfile,
  faceWall,
  roomFold,
  ROOM_WALL_LABEL,
  virtualSides,
  activeScene,
  ambientActorCues,
  buildActorRoute,
  polygonBBox,
  routePose,
  stageBounds,
  type ActorCue,
  type Presence,
  type Route,
  type SessionState,
} from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { outputHealth } from './ui.tsx';

interface Props {
  state: SessionState;
  presence: Presence;
  selected: string[];
  allSelected: boolean;
  onToggle: (surfaceId: string) => void;
  now: () => number;
  L: Tr;
}

const LIGHT: Record<string, string> = { ok: '#3ddc97', warn: '#ffd23f', bad: '#ff4b4b', off: '#6f6a96' };

/** Glanceable stage overview: surfaces glow in their scene colors, outputs show a status light, creatures move live. */
export function StageMap({ state, presence, selected, allSelected, onToggle, now, L }: Props) {
  const fold = useMemo(() => roomFold(state.surfaces), [state.surfaces]);
  // the sides the app adds itself are part of the room too (a projector may light them)
  const virt = useMemo(() => virtualSides(fold), [fold]);
  const b = useMemo(() => {
    const raw0 = stageBounds(state.surfaces, state.outputs);
    let raw = raw0;
    for (const v of virt) {
      const x0 = Math.min(raw.x, v.rect.x);
      const y0 = Math.min(raw.y, v.rect.y);
      const x1 = Math.max(raw.x + raw.w, v.rect.x + v.rect.w);
      const y1 = Math.max(raw.y + raw.h, v.rect.y + v.rect.h);
      raw = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    const pad = Math.max(raw.w, raw.h) * 0.06;
    return { x: raw.x - pad, y: raw.y - pad, w: raw.w + pad * 2, h: raw.h + pad * 2 };
  }, [state.surfaces, state.outputs, virt]);
  const [tick, setTick] = useState(0);
  const routes = useRef(new Map<string, Route | null>());

  // ~12 fps animation for creatures on the map
  useEffect(() => {
    let id = 0;
    let last = 0;
    const loop = (t: number) => {
      id = requestAnimationFrame(loop);
      if (t - last > 80) {
        last = t;
        setTick((x) => x + 1);
      }
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  const t = now();
  void tick;
  const actors: { key: string; x: number; y: number; icon: string; size: number }[] = [];
  const cues: ActorCue[] = [
    ...state.cues.filter((c): c is ActorCue => c.kind === 'actor'),
    ...ambientActorCues(state.ambient, state.surfaces, catalog, t),
  ];
  for (const cue of cues) {
    if (t < cue.startAt || t >= cue.endAt) continue;
    const manifest = catalog.get(cue.themeId)?.actors.find((a) => a.id === cue.actorId);
    if (!manifest) continue;
    for (let i = 0; i < cue.count; i++) {
      const k = `${cue.id}:${cue.seed}:${i}:${state.revision}`;
      let r = routes.current.get(k);
      if (r === undefined) {
        r = buildActorRoute(state.surfaces, manifest, cue, i);
        routes.current.set(k, r);
        if (routes.current.size > 200) routes.current.delete(routes.current.keys().next().value as string);
      }
      if (!r) continue;
      const pose = routePose(r, t - cue.startAt);
      if (pose.visible)
        actors.push({
          key: `${cue.id}-${i}`,
          x: pose.x,
          y: pose.y,
          icon: manifest.icon,
          size: Math.max(manifest.sizeM, b.w / 30),
        });
    }
  }

  const fontSize = Math.max(b.w, b.h) / 26;
  if (state.surfaces.length === 0 && state.outputs.length === 0) {
    return (
      <div className="stage-map" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
        <p className="muted">
          {L(
            'No surfaces yet. Connect a projector PC (tab “Projectors”) – a surface is created automatically.',
            'Noch keine Flächen. Verbinde einen Beamer-PC (Tab „Beamer“) – eine Fläche wird automatisch angelegt.',
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="stage-map">
      <svg
        viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
        role="group"
        aria-label={L('Stage overview', 'Bühnenübersicht')}
      >
        <defs>
          {state.surfaces.map((s) => {
            const act = activeScene(s.playback, state.playlists, t);
            const sc = act
              ? catalog.get(act.scene.themeId)?.scenes.find((x) => x.id === act.scene.sceneId)
              : undefined;
            const [c1, c2] = sc?.colors ?? ['#222', '#555'];
            return (
              <linearGradient key={s.id} id={`g-${s.id}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={c1} />
                <stop offset="1" stopColor={c2} />
              </linearGradient>
            );
          })}
        </defs>
        {virt.map((v) => (
          <g key={v.id} pointerEvents="none">
            <rect
              x={v.rect.x}
              y={v.rect.y}
              width={v.rect.w}
              height={v.rect.h}
              fill="rgba(120,100,220,0.12)"
              stroke="rgba(160,140,255,0.35)"
              strokeWidth={fontSize * 0.05}
            />
            <text
              className="label"
              x={v.rect.x + v.rect.w / 2}
              y={v.rect.y + v.rect.h / 2}
              fontSize={fontSize * 0.8}
              textAnchor="middle"
              strokeWidth={fontSize * 0.2}
              style={{ opacity: 0.75 }}
            >
              {v.wall ? ROOM_WALL_LABEL[v.wall] : ''}
            </text>
          </g>
        ))}
        {state.surfaces.map((s) => {
          const on = allSelected || selected.includes(s.id);
          const bb = polygonBBox(s.polygon);
          const act = activeScene(s.playback, state.playlists, t);
          const sc = act
            ? catalog.get(act.scene.themeId)?.scenes.find((x) => x.id === act.scene.sceneId)
            : undefined;
          const hasEffect = state.cues.some(
            (c) => c.kind === 'effect' && c.surfaceIds.includes(s.id) && t >= c.startAt && t < c.endAt,
          );
          return (
            <g
              key={s.id}
              className="surface-shape"
              onClick={() => onToggle(s.id)}
              role="button"
              aria-pressed={on}
              aria-label={s.name}
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggle(s.id)}
            >
              <polygon
                points={s.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={`url(#g-${s.id})`}
                opacity={on ? 0.9 : 0.35}
                stroke={on ? '#ffb347' : 'rgba(255,255,255,0.25)'}
                strokeWidth={on ? fontSize * 0.18 : fontSize * 0.06}
                strokeLinejoin="round"
              />
              {hasEffect && (
                <polygon
                  points={s.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="rgba(255,255,255,0.25)"
                  style={{ animation: 'fired 0.6s ease-out' }}
                />
              )}
              <text
                className="label"
                x={bb.x + bb.w / 2}
                y={bb.y + bb.h / 2}
                fontSize={fontSize}
                textAnchor="middle"
                strokeWidth={fontSize * 0.25}
              >
                {s.name}
              </text>
              <text
                className="label"
                x={bb.x + bb.w / 2}
                y={bb.y + bb.h / 2 + fontSize * 1.1}
                fontSize={fontSize * 0.7}
                textAnchor="middle"
                strokeWidth={fontSize * 0.2}
                style={{ fontWeight: 500 }}
              >
                {sc ? `${sc.icon} ${L.text(sc.name)}` : '–'}
              </text>
            </g>
          );
        })}
        {state.outputs.map((o) => {
          const prof = activeProfile(o);
          // a projector in the room: its frame is the sides it lights (they may have changed size)
          let vp = prof.viewport;
          if (prof.pose && prof.walls?.length) {
            const faces = fold.faces.filter((f) => {
              const w = faceWall(fold, f);
              return w && prof.walls!.includes(w);
            });
            if (faces.length) {
              const x0 = Math.min(...faces.map((f) => f.rect.x));
              const y0 = Math.min(...faces.map((f) => f.rect.y));
              const x1 = Math.max(...faces.map((f) => f.rect.x + f.rect.w));
              const y1 = Math.max(...faces.map((f) => f.rect.y + f.rect.h));
              vp = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
            }
          }
          const h = outputHealth(o, state, presence, L);
          return (
            <g key={o.id} pointerEvents="none">
              <rect
                x={vp.x}
                y={vp.y}
                width={vp.w}
                height={vp.h}
                fill="none"
                stroke={o.blackout || state.blackoutAll ? '#ff4b4b' : 'rgba(255,255,255,0.55)'}
                strokeWidth={fontSize * 0.07}
                strokeDasharray={`${fontSize * 0.4} ${fontSize * 0.25}`}
              />
              <circle
                cx={vp.x + fontSize * 0.6}
                cy={vp.y + fontSize * 0.6}
                r={fontSize * 0.32}
                fill={LIGHT[h.level]}
              />
              <text
                className="label"
                x={vp.x + fontSize * 1.1}
                y={vp.y + fontSize * 0.85}
                fontSize={fontSize * 0.65}
                strokeWidth={fontSize * 0.15}
              >
                {o.name}
              </text>
            </g>
          );
        })}
        {actors.map((a) => (
          <text
            key={a.key}
            x={a.x}
            y={a.y}
            fontSize={a.size * 1.4}
            textAnchor="middle"
            dominantBaseline="central"
            pointerEvents="none"
          >
            {a.icon}
          </text>
        ))}
      </svg>
      <span className="stage-map-hint">
        {L('Tap surfaces to choose targets', 'Flächen antippen, um Ziele zu wählen')}
      </span>
    </div>
  );
}
