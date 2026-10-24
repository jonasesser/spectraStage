/**
 * World events: things that happen in the stage world itself and therefore cross surfaces.
 * The unfolded stage is the geometry: going down past the bottom edge of a wall means arriving on
 * the ground in front of it (the floor surface laid out below that wall). So a cat that jumps out
 * of a window falls down the wall and lands on the driveway, a pumpkin rolls off the lawn onto the
 * floor, a ghost dives out of the house and glides across the ground.
 *
 * Every surface computes the same schedule from the shared world seed and scene time and draws
 * only the part that lies on itself – a creature on the seam is drawn half by each projector.
 */
import { hash01, smoothstep } from '@spectrastage/engine';
import type { DrawState } from '@spectrastage/engine';
import type { Palette } from '../palette.ts';
import { cat, ghost, pumpkin } from '../shapes.ts';

export type WorldEventKind = 'catJump' | 'ghostDive' | 'pumpkinRoll';

export const WORLD_EVENTS: Record<string, WorldEventKind[]> = {
  spookWorld: ['catJump', 'ghostDive', 'pumpkinRoll'],
  neonWorld: ['catJump', 'ghostDive', 'pumpkinRoll'],
  partyWorld: ['ghostDive', 'pumpkinRoll'],
  quietWorld: ['ghostDive'],
};
const HAS_HOUSE = new Set(['spookWorld', 'neonWorld']);

const DUR: Record<WorldEventKind, number> = { catJump: 7, ghostDive: 8, pumpkinRoll: 7 };
const PERIOD = 26;

type Rect = { x: number; y: number; w: number; h: number };

interface Geo {
  main: Rect;
  /** Ground surface in front of the main wall (below it in the unfolded stage), if any. */
  ground: Rect | null;
  U: number;
  houseX: number;
  houseW: number;
  groundY: number;
}

function geo(s: DrawState): Geo | null {
  const w = s.world;
  if (!w) return null;
  const main = w.surfaces.find((x) => x.role === 'main')?.rect;
  if (!main) return null;
  const bottom = main.y + main.h;
  const ground =
    w.surfaces
      .filter((x) => x.role === 'ground')
      .map((x) => x.rect)
      .filter((r) => Math.abs(r.y - bottom) < 0.6 && r.x < main.x + main.w && r.x + r.w > main.x)
      .sort((a, b) => Math.abs(a.y - bottom) - Math.abs(b.y - bottom))[0] ?? null;
  const U = Math.max(0.5, main.h);
  return {
    main,
    ground,
    U,
    houseX: main.x + main.w / 2,
    houseW: Math.min(main.w * 0.56, U * 0.66),
    groundY: main.y + U * 0.8,
  };
}

/** Where things land: on the floor in front of the wall, or on the lawn if there is no floor. */
function landing(G: Geo, x: number, k: number): { x: number; y: number } {
  if (G.ground) {
    const gx = Math.max(G.ground.x + 0.3, Math.min(G.ground.x + G.ground.w - 0.3, x));
    return { x: gx, y: G.ground.y + Math.min(G.ground.h * 0.4, 1.2) * k };
  }
  return { x, y: G.groundY + G.U * 0.08 };
}

export function drawWorldEvents(g: CanvasRenderingContext2D, s: DrawState, pal: Palette, t: number): void {
  const worldId = String(s.params.worldId ?? '');
  const kinds = WORLD_EVENTS[worldId];
  const G = geo(s);
  if (!kinds || !G || !s.world) return;
  const r = s.world.self.rect;
  const ppm = s.ppm;
  const X = (x: number) => (x - r.x) * ppm;
  const Y = (y: number) => (y - r.y) * ppm;
  const near = (x: number, y: number, rad: number) =>
    x + rad > r.x && x - rad < r.x + r.w && y + rad > r.y && y - rad < r.y + r.h;
  const seed = s.world.seed & 0xffff;
  const slot = Math.floor(t / PERIOD);
  for (const k of [slot - 1, slot]) {
    if (k < 0) continue;
    const h = (n: number) => hash01(seed * 7919 + k * 104729 + n * 1299709);
    if (h(0) > 0.85) continue;
    let ev = kinds[Math.floor(h(1) * kinds.length)]!;
    if (ev === 'catJump' && !HAS_HOUSE.has(worldId)) ev = 'ghostDive';
    const dur = DUR[ev];
    const lt = t - (k * PERIOD + 4 + h(2) * (PERIOD - dur - 6));
    if (lt < 0 || lt > dur) continue;
    const side = h(3) < 0.5 ? -1 : 1;

    if (ev === 'catJump') {
      // out of an upper window, falls down the facade, lands on the floor, runs off
      const wx = G.houseX + side * G.houseW * (0.18 + 0.12 * h(4));
      const wy = G.groundY - G.houseW * 0.5;
      const land = landing(G, wx + side * G.U * 0.35, 0.5);
      const size = G.U * 0.22;
      let px: number;
      let py: number;
      let moving = true;
      let flip = side < 0;
      if (lt < 0.6) {
        // crouches in the window
        px = wx;
        py = wy;
        moving = false;
      } else if (lt < 2.2) {
        // ballistic arc: x linear, y with gravity
        const u = (lt - 0.6) / 1.6;
        px = wx + (land.x - wx) * u;
        py = wy - G.U * 0.12 * Math.sin(u * Math.PI) * (1 - u) + (land.y - wy) * u * u;
      } else if (lt < 2.8) {
        px = land.x;
        py = land.y;
        moving = false;
      } else {
        // runs away over the floor, out of the picture
        const u = (lt - 2.8) / (dur - 2.8);
        const dir = h(5) < 0.5 ? -1 : 1;
        px = land.x + dir * u * G.U * 2.5;
        py = land.y + u * G.U * 0.6;
        flip = dir < 0;
      }
      if (!near(px, py, size)) continue;
      g.save();
      g.translate(X(px), Y(py));
      if (flip) g.scale(-1, 1);
      cat(g, size * ppm, lt * 9, moving, t, pal);
      g.restore();
    } else if (ev === 'ghostDive') {
      // swoops out of the house (or down from the sky), glides over the ground, fades out
      const sx = HAS_HOUSE.has(worldId) ? G.houseX : G.main.x + G.main.w * (0.2 + 0.6 * h(4));
      const sy = HAS_HOUSE.has(worldId) ? G.groundY - G.houseW * 0.35 : G.main.y + G.U * 0.3;
      const end = landing(G, sx + side * G.U * 1.2, 0.8);
      const u = lt / dur;
      const e = smoothstep(0, 1, u);
      const px = sx + (end.x - sx) * e + Math.sin(u * Math.PI * 2) * G.U * 0.15 * side;
      const py = sy + (end.y - sy) * e - Math.sin(u * Math.PI) * G.U * 0.1;
      const size = G.U * (0.18 + 0.1 * Math.sin(u * Math.PI));
      const a = smoothstep(0, 0.12, u) * (1 - smoothstep(0.85, 1, u));
      if (!near(px, py, size)) continue;
      ghost(g, X(px), Y(py), size * ppm, {
        color: pal.ghost,
        t,
        alpha: a,
        face: u < 0.5 ? 'wow' : 'happy',
        wave: Math.sin(t * 6) * 0.7,
        mirror: side < 0,
      });
    } else {
      // a pumpkin topples off the lawn edge, bounces onto the floor and rolls away
      const sx = G.main.x + G.main.w * (0.15 + 0.7 * h(4));
      const sy = G.groundY + G.U * 0.1;
      const land = landing(G, sx + side * G.U * 0.2, 0.25);
      const size = G.U * 0.1;
      let px: number;
      let py: number;
      let rot: number;
      if (lt < 1.4) {
        const u = lt / 1.4;
        px = sx + (land.x - sx) * u;
        py = sy + (land.y - sy) * u * u;
        rot = u * 2 * side;
      } else {
        const u = (lt - 1.4) / (dur - 1.4);
        const bounce = Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) * G.U * 0.05;
        px = land.x + side * u * G.U * 2;
        py = land.y + u * G.U * 0.8 - bounce;
        rot = (2 + u * 14) * side;
      }
      if (!near(px, py, size)) continue;
      g.save();
      g.translate(X(px), Y(py));
      g.rotate(rot);
      pumpkin(g, 0, 0, size * ppm, { pal, face: Math.floor(h(6) * 6), t, glow: 0.9 });
      g.restore();
    }
  }
}
