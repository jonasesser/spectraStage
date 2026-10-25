/**
 * Worlds: one scene spread over the whole stage. Every surface shows its own part of it –
 * the centerpiece (e.g. the house) exists exactly once on the main wall, the other walls continue
 * the world (graveyard, ghost forest …), the ground and the ceiling get their own parts.
 * Sky, clouds and the single moon are computed in shared world coordinates (see SKY_FRAG), and in
 * room mode they wrap around from the last wall back to the first.
 */
import type { SceneContext, SceneModule } from '@spectrastage/engine';
import { hybridScene, hash01 } from '@spectrastage/engine';
import { palette } from '../palette.ts';
import { speedOf } from './common.ts';
import { addGlow, envPalette, SKY_FRAG, skyUniforms } from './env.ts';
import { drawRoomBats, drawWorldEvents } from './worldEvents.ts';

type CeilingKind = 'night' | 'neon' | 'party' | 'magic' | 'monster';

/**
 * Ceilings: the sky seen from below, one per world. Night: stars, clouds, bats. Neon: glowing
 * purple/green sky. Party: string lights from the corners to a disco ball in the middle. Magic:
 * an aurora swirl with spirits. Monster: huge eyes opening in the clouds.
 */
function ceiling(id: string, kind: CeilingKind): SceneModule {
  return hybridScene(
    id,
    SKY_FRAG,
    (s) =>
      skyUniforms(
        s,
        envPalette(kind === 'neon' ? { ...s.params, mood: 'neon' } : s.params),
        { moon: [0.5, -3], moonR: 0.06, horizonY: kind === 'neon' ? 0.1 : -0.6, clouds: 0.8, cloudBand: 2 },
        speedOf(s),
      ),
    (g, s, f) => {
      const pal = palette(kind === 'neon' ? { ...s.params, mood: 'neon' } : s.params);
      const t = f.time * speedOf(s);
      const { w, h } = s;
      const m = Math.min(w, h);
      const cx = w / 2;
      const cy = h / 2;
      if (kind === 'party') {
        for (const [x0, y0] of [
          [0, 0],
          [w, 0],
          [w, h],
          [0, h],
        ] as const) {
          for (let k = 0; k < 2; k++) {
            g.strokeStyle = 'rgba(80,70,90,0.8)';
            g.lineWidth = Math.max(1, m * 0.004);
            g.beginPath();
            g.moveTo(x0, y0);
            g.quadraticCurveTo((x0 + cx) / 2 + (k ? 20 : -20), (y0 + cy) / 2 + (k ? -20 : 20), cx, cy);
            g.stroke();
            for (let i = 1; i < 10; i++) {
              const u = i / 10;
              const mx = (x0 + cx) / 2 + (k ? 20 : -20);
              const my = (y0 + cy) / 2 + (k ? -20 : 20);
              const x = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * mx + u * u * cx;
              const y = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * my + u * u * cy;
              const c = pal.party[(i + k) % pal.party.length]!;
              const tw = 0.55 + 0.45 * Math.sin(t * 1.5 + i + k);
              addGlow(g, x, y, m * 0.035, c, 0.55 * tw);
              g.fillStyle = c;
              g.beginPath();
              g.arc(x, y, m * 0.008, 0, Math.PI * 2);
              g.fill();
            }
          }
        }
        const br = m * 0.07;
        const ball = g.createRadialGradient(cx - br * 0.3, cy - br * 0.3, br * 0.1, cx, cy, br);
        ball.addColorStop(0, '#ffffff');
        ball.addColorStop(1, '#5a5f7a');
        g.fillStyle = ball;
        g.beginPath();
        g.arc(cx, cy, br, 0, Math.PI * 2);
        g.fill();
        for (let i = 0; i < 8; i++) {
          const a = t * 0.6 + (i / 8) * Math.PI * 2;
          addGlow(
            g,
            cx + Math.cos(a) * m * 0.35,
            cy + Math.sin(a) * m * 0.35,
            m * 0.04,
            pal.party[i % pal.party.length]!,
            0.6,
          );
        }
        return;
      }
      if (kind === 'magic') {
        for (let k = 0; k < 4; k++) {
          const a = t * 0.15 + k * 1.6;
          addGlow(
            g,
            cx + Math.cos(a) * m * 0.3,
            cy + Math.sin(a * 1.3) * m * 0.25,
            m * 0.5,
            [pal.accent, '#7dffd8', pal.secondary, '#b06bff'][k]!,
            0.35,
          );
        }
      }
      if (kind === 'monster') {
        for (let i = 0; i < 3; i++) {
          const ph = (t / (9 + i * 2) + hash01(i * 5)) % 1;
          const open = Math.sin(Math.min(1, Math.max(0, (ph - 0.2) / 0.5)) * Math.PI);
          if (open < 0.02) continue;
          const ex = w * (0.25 + 0.5 * hash01(i * 7 + Math.floor(t / (9 + i * 2))));
          const ey = h * (0.25 + 0.5 * hash01(i * 11 + Math.floor(t / (9 + i * 2))));
          const er = m * 0.06;
          for (const sd of [-1, 1]) {
            addGlow(g, ex + sd * er * 1.6, ey, er * 2.5, '#b6ff4d', 0.35 * open);
            g.fillStyle = '#d6ff6b';
            g.beginPath();
            g.ellipse(ex + sd * er * 1.6, ey, er, er * 0.6 * open, 0, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = '#000';
            g.beginPath();
            g.ellipse(ex + sd * er * 1.6, ey, er * 0.15, er * 0.5 * open, 0, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    },
    { shaderScale: 0.5 },
  );
}

export const nightSky = ceiling('nightSky', 'night');
export const ceilingScenes: SceneModule[] = [
  ceiling('neonCeiling', 'neon'),
  ceiling('partyCeiling', 'party'),
  ceiling('magicCeiling', 'magic'),
  ceiling('monsterCeiling', 'monster'),
];

export interface WorldParts {
  main: string;
  side: string[];
  ground: string[];
  ceiling?: string;
}

export const WORLDS: Record<string, WorldParts> = {
  // Walls are one continuous panorama (see panorama.ts); ground and ceiling are their own planes.
  spookWorld: { main: 'spookPanorama', side: ['spookPanorama'], ground: ['spookGround'] },
  partyWorld: {
    main: 'partyPanorama',
    side: ['partyPanorama'],
    ground: ['partyGround'],
    ceiling: 'partyCeiling',
  },
  neonWorld: { main: 'neonPanorama', side: ['neonPanorama'], ground: ['neonGround'], ceiling: 'neonCeiling' },
  magicWorld: {
    main: 'magicPanorama',
    side: ['magicPanorama'],
    ground: ['magicGround'],
    ceiling: 'magicCeiling',
  },
  monsterWorld: {
    main: 'monsterPanorama',
    side: ['monsterPanorama'],
    ground: ['monsterGround'],
    ceiling: 'monsterCeiling',
  },
  quietWorld: { main: 'quietPanorama', side: ['quietPanorama'], ground: ['quietGround'] },
};

/** Which part scene a surface plays inside a world. */
export function partFor(parts: WorldParts, ctx: Pick<SceneContext, 'world' | 'kind'>): string {
  const w = ctx.world?.self;
  const role = w?.role ?? (ctx.kind === 'floor' ? 'ground' : 'main');
  const i = w?.roleIndex ?? 0;
  if (role === 'main') return parts.main;
  if (role === 'ground') return parts.ground[i % parts.ground.length]!;
  if (role === 'ceiling') return parts.ceiling ?? 'nightSky';
  return parts.side[i % parts.side.length]!;
}

export function worldScenes(byId: Record<string, SceneModule>): SceneModule[] {
  return Object.entries(WORLDS).map(([id, parts]) => {
    const main = byId[parts.main];
    return {
      id,
      create: (ctx) => {
        const mod = byId[partFor(parts, ctx)] ?? main!;
        // Parts learn which world they belong to (for world events that cross surfaces).
        const tag = (p: SceneContext['params']) => ({ ...p, worldId: id });
        const inst = mod.create({
          ...ctx,
          params: tag(ctx.params),
          overlay: (g, s, f) => {
            const pal = palette(s.params);
            drawRoomBats(g, s, pal, f.time * speedOf(s));
            drawWorldEvents(g, s, pal, f.time * speedOf(s));
          },
        });
        return {
          render: (target, frame) => inst.render(target, frame),
          resize: (w, h, ppm) => inst.resize(w, h, ppm),
          setParams: (p) => inst.setParams(tag(p)),
          dispose: () => inst.dispose(),
        };
      },
      ambientSound: main?.ambientSound,
    } satisfies SceneModule;
  });
}
