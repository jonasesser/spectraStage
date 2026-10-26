/**
 * Set pieces for the faces of a world: every wall of the room gets its own centerpiece that
 * belongs to the same world (graveyard with crypt, dark forest, pumpkin patch with scarecrow,
 * witch's cauldron, bonfire, dance stage …). They stand on the shared ground line of the
 * panorama, so the walls still join seamlessly – only the "what" differs per wall.
 *
 * Coordinates: x = center in px, y = ground line in px, u = world unit (main wall height) in px.
 */
import { hash01, noise1, smoothstep, TAU } from '@spectrastage/engine';
import type { Palette } from '../palette.ts';
import { dancePose, ghost, objScale, pumpkin, skeleton, withObjectScale } from '../shapes.ts';
import { addGlow, mixHex, paintTombstone, paintTree, type EnvPalette, type StoneKind } from './env.ts';
import { monster } from './wall.ts';

export type PieceId =
  'graveyard' | 'forest' | 'pumpkinPatch' | 'cauldron' | 'bonfire' | 'stage' | 'crypt' | 'monsterGraves';

export interface PieceCtx {
  x: number;
  y: number;
  u: number;
  env: EnvPalette;
  pal: Palette;
  seed: number;
}

/** Half width in world units (multiples of the main wall height). */
export const PIECE_HALF: Record<PieceId, number> = {
  graveyard: 0.75,
  forest: 0.8,
  pumpkinPatch: 0.7,
  cauldron: 0.45,
  bonfire: 0.55,
  stage: 0.85,
  crypt: 0.8,
  monsterGraves: 0.75,
};

const KINDS: StoneKind[] = ['round', 'cross', 'square', 'obelisk', 'round', 'cross'];

function crypt(g: CanvasRenderingContext2D, c: PieceCtx, scale: number) {
  const { x, y, u, env } = c;
  const w = u * 0.42 * scale;
  const h = u * 0.3 * scale;
  // body
  const body = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  body.addColorStop(0, mixHex(env.stone, env.near, 0.55));
  body.addColorStop(0.7, mixHex(env.stoneLit, env.stone, 0.4));
  body.addColorStop(1, mixHex(env.stone, env.near, 0.4));
  g.fillStyle = body;
  g.fillRect(x - w / 2, y - h, w, h);
  // columns
  g.fillStyle = mixHex(env.stoneLit, env.stone, 0.3);
  for (const k of [-0.42, -0.26, 0.26, 0.42])
    g.fillRect(x + k * w - w * 0.03, y - h * 0.92, w * 0.06, h * 0.92);
  // pediment
  g.fillStyle = mixHex(env.stone, env.near, 0.35);
  g.beginPath();
  g.moveTo(x - w * 0.58, y - h);
  g.lineTo(x, y - h - h * 0.45);
  g.lineTo(x + w * 0.58, y - h);
  g.closePath();
  g.fill();
  g.fillStyle = mixHex(env.stoneLit, env.stone, 0.5);
  g.fillRect(x - w * 0.6, y - h - h * 0.05, w * 1.2, h * 0.07);
  // dark door with a faint glow
  g.fillStyle = '#05040a';
  g.beginPath();
  g.moveTo(x - w * 0.14, y);
  g.lineTo(x - w * 0.14, y - h * 0.55);
  g.arc(x, y - h * 0.55, w * 0.14, Math.PI, 0);
  g.lineTo(x + w * 0.14, y);
  g.closePath();
  g.fill();
  // steps
  g.fillStyle = mixHex(env.stone, env.near, 0.5);
  g.fillRect(x - w * 0.62, y - h * 0.04, w * 1.24, h * 0.06);
}

function graves(g: CanvasRenderingContext2D, c: PieceCtx, n: number, spread: number) {
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    const k = Math.floor(i / 2);
    const gx = c.x + side * c.u * (0.28 + k * spread) + (hash01(c.seed + i) - 0.5) * c.u * 0.05;
    const gy = c.y + c.u * (0.02 + 0.05 * hash01(c.seed + i * 3));
    paintTombstone(
      g,
      gx,
      gy,
      c.u * (0.07 + 0.03 * hash01(i * 7 + c.seed)),
      KINDS[i % KINDS.length]!,
      c.env,
      1,
      c.seed + i,
      (hash01(i * 11) - 0.5) * 0.2,
    );
  }
}

function scarecrow(g: CanvasRenderingContext2D, c: PieceCtx) {
  const { x, y, u, env } = c;
  const h = u * 0.5;
  g.strokeStyle = mixHex(env.tree, '#3a2a1a', 0.5);
  g.lineCap = 'round';
  g.lineWidth = u * 0.018;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - h);
  g.moveTo(x - h * 0.42, y - h * 0.68);
  g.lineTo(x + h * 0.42, y - h * 0.68);
  g.stroke();
  // coat (neon: purple with a lime glow)
  if (env.neon) {
    g.save();
    g.shadowColor = '#7dff4d';
    g.shadowBlur = u * 0.04;
  }
  g.fillStyle = env.neon ? '#6a2ab8' : '#3b2a4a';
  g.beginPath();
  g.moveTo(x - h * 0.16, y - h * 0.74);
  g.lineTo(x + h * 0.16, y - h * 0.74);
  g.lineTo(x + h * 0.22, y - h * 0.3);
  g.lineTo(x + h * 0.05, y - h * 0.34);
  g.lineTo(x, y - h * 0.28);
  g.lineTo(x - h * 0.06, y - h * 0.34);
  g.lineTo(x - h * 0.22, y - h * 0.3);
  g.closePath();
  g.fill();
  // straw hands
  g.strokeStyle = '#c9a24a';
  g.lineWidth = u * 0.006;
  for (const sd of [-1, 1])
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.moveTo(x + sd * h * 0.42, y - h * 0.68);
      g.lineTo(x + sd * h * (0.47 + k * 0.01), y - h * (0.62 + k * 0.03));
      g.stroke();
    }
  if (env.neon) g.restore();
  // sack head + hat
  g.fillStyle = env.neon ? '#ff9a3a' : '#b89a6a';
  g.beginPath();
  g.ellipse(x, y - h * 0.86, h * 0.11, h * 0.13, 0, 0, TAU);
  g.fill();
  if (env.neon) {
    // carved glowing face
    g.fillStyle = '#fff2a0';
    for (const sd of [-1, 1]) {
      g.beginPath();
      g.moveTo(x + sd * h * 0.06, y - h * 0.9);
      g.lineTo(x + sd * h * 0.02, y - h * 0.86);
      g.lineTo(x + sd * h * 0.09, y - h * 0.86);
      g.fill();
    }
    g.fillRect(x - h * 0.05, y - h * 0.81, h * 0.1, h * 0.02);
    addGlow(g, x, y - h * 0.86, h * 0.3, '#ff8a2e', 0.4);
  }
  g.fillStyle = '#1a1220';
  g.fillRect(x - h * 0.2, y - h * 0.97, h * 0.4, h * 0.035);
  g.beginPath();
  g.moveTo(x - h * 0.1, y - h * 0.96);
  g.lineTo(x - h * 0.03, y - h * 1.18);
  g.lineTo(x + h * 0.09, y - h * 0.96);
  g.fill();
}

function cauldronBody(g: CanvasRenderingContext2D, c: PieceCtx) {
  const { x, y, u, env } = c;
  const r = u * 0.13;
  // logs
  g.fillStyle = mixHex(env.tree, '#3a2414', 0.5);
  g.save();
  g.translate(x, y - r * 0.1);
  for (const a of [-0.35, 0.35]) {
    g.save();
    g.rotate(a);
    g.fillRect(-r * 1.1, -r * 0.08, r * 2.2, r * 0.16);
    g.restore();
  }
  g.restore();
  // pot
  const pot = g.createRadialGradient(x - r * 0.4, y - r * 1.3, r * 0.1, x, y - r, r * 1.2);
  pot.addColorStop(0, '#3a3548');
  pot.addColorStop(1, '#07060b');
  g.fillStyle = pot;
  g.beginPath();
  g.ellipse(x, y - r * 1.05, r * 1.1, r * 0.95, 0, 0, TAU);
  g.fill();
  g.fillStyle = '#0d0b14';
  g.fillRect(x - r * 1.15, y - r * 1.95, r * 2.3, r * 0.2);
  // legs
  g.fillRect(x - r * 0.8, y - r * 0.25, r * 0.12, r * 0.25);
  g.fillRect(x + r * 0.68, y - r * 0.25, r * 0.12, r * 0.25);
}

function fire(g: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, seed: number) {
  addGlow(g, x, y - s * 0.4, s * 2.4, '#ff8a2a', 0.45 + 0.1 * Math.sin(t * 9));
  for (let i = 0; i < 6; i++) {
    const ph = noise1(t * 3 + i * 2.1, seed + i);
    const fx = x + (i - 2.5) * s * 0.16;
    const fh = s * (0.6 + 0.6 * ph) * (1 - Math.abs(i - 2.5) * 0.12);
    const gr = g.createLinearGradient(0, y, 0, y - fh);
    gr.addColorStop(0, '#fff2a0');
    gr.addColorStop(0.4, '#ffb23a');
    gr.addColorStop(1, 'rgba(255,70,20,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(fx - s * 0.14, y);
    g.quadraticCurveTo(fx - s * 0.12, y - fh * 0.6, fx + Math.sin(t * 6 + i) * s * 0.06, y - fh);
    g.quadraticCurveTo(fx + s * 0.12, y - fh * 0.6, fx + s * 0.14, y);
    g.closePath();
    g.fill();
  }
}

/** Static part of a piece (painted once into the panorama layer). */
export function paintPiece(g: CanvasRenderingContext2D, id: PieceId, c: PieceCtx): void {
  // object size: the whole piece bigger / smaller (its parts are not scaled twice)
  const k = objScale();
  if (k !== 1) return withObjectScale(1, () => paintPiece(g, id, { ...c, u: c.u * k }));
  const { x, y, u, env } = c;
  switch (id) {
    case 'graveyard':
      crypt(g, c, 1);
      graves(g, c, 6, 0.16);
      break;
    case 'crypt':
      crypt(g, c, 1.5);
      graves(g, c, 8, 0.13);
      break;
    case 'monsterGraves':
      graves(g, c, 6, 0.2);
      break;
    case 'forest':
      for (const [dx, hh, sd] of [
        [-0.45, 0.62, 1],
        [0.05, 0.75, 2],
        [0.5, 0.58, 3],
        [-0.15, 0.48, 4],
      ] as const)
        paintTree(g, c.seed + sd * 17, x + dx * u, y + u * 0.03, hh * u, env, 1);
      break;
    case 'pumpkinPatch': {
      // vines
      g.strokeStyle = mixHex(env.grass, '#2f5a1a', 0.5);
      g.lineWidth = u * 0.008;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(x - u * 0.65, y + u * (0.02 + k * 0.035));
        for (let i = 1; i <= 12; i++)
          g.lineTo(
            x - u * 0.65 + (u * 1.3 * i) / 12,
            y + u * (0.02 + k * 0.035) + Math.sin(i * 1.7 + k) * u * 0.01,
          );
        g.stroke();
      }
      scarecrow(g, c);
      break;
    }
    case 'cauldron':
      cauldronBody(g, c);
      break;
    case 'bonfire':
      g.fillStyle = mixHex(env.tree, '#3a2414', 0.5);
      for (const a of [-0.5, 0, 0.5]) {
        g.save();
        g.translate(x, y - u * 0.02);
        g.rotate(a);
        g.fillRect(-u * 0.13, -u * 0.015, u * 0.26, u * 0.03);
        g.restore();
      }
      break;
    case 'stage': {
      // wooden dance floor platform
      const w = u * 1.5;
      g.fillStyle = mixHex('#4a3020', env.near, 0.4);
      g.fillRect(x - w / 2, y - u * 0.05, w, u * 0.06);
      g.fillStyle = mixHex('#6a4a30', env.near, 0.3);
      g.fillRect(x - w / 2, y - u * 0.06, w, u * 0.015);
      // disco ball wire
      g.strokeStyle = '#888';
      g.lineWidth = Math.max(1, u * 0.002);
      g.beginPath();
      g.moveTo(x, y - u * 0.8);
      g.lineTo(x, y - u * 0.6);
      g.stroke();
      break;
    }
  }
}

/** Animated part of a piece. */
export function drawPiece(g: CanvasRenderingContext2D, id: PieceId, c: PieceCtx, t: number): void {
  const k = objScale();
  if (k !== 1) return withObjectScale(1, () => drawPiece(g, id, { ...c, u: c.u * k }, t));
  const { x, y, u, pal } = c;
  switch (id) {
    case 'graveyard':
    case 'crypt': {
      // will-o'-the-wisps floating between the graves, a glow in the crypt door
      addGlow(g, x, y - u * 0.08, u * 0.1, pal.accent, 0.25 + 0.15 * Math.sin(t * 1.3));
      for (let i = 0; i < 4; i++) {
        const wx = x + Math.sin(t * 0.4 + i * 1.7) * u * 0.6;
        const wy = y - u * (0.08 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.9 + i * 2.3)));
        addGlow(g, wx, wy, u * 0.04, '#9ffcff', 0.5 + 0.3 * Math.sin(t * 3 + i));
      }
      break;
    }
    case 'monsterGraves': {
      // monsters rise behind the gravestones and sink again
      for (let i = 0; i < 4; i++) {
        const ph = (t / (6 + i * 1.3) + hash01(c.seed + i)) % 1;
        const vis = smoothstep(0.05, 0.25, ph) * (1 - smoothstep(0.55, 0.75, ph));
        if (vis < 0.02) continue;
        const side = i % 2 ? 1 : -1;
        const mx = x + side * u * (0.28 + Math.floor(i / 2) * 0.2);
        g.save();
        g.beginPath();
        g.rect(mx - u * 0.2, y - u * 0.5, u * 0.4, u * 0.47);
        g.clip();
        monster(g, i + c.seed, mx, y + u * 0.05 - vis * u * 0.16, u * 0.16, t, Math.sin(t * 4 + i));
        g.restore();
      }
      break;
    }
    case 'forest':
      // eyes in the dark between the trunks
      for (let i = 0; i < 6; i++) {
        const ex = x + (hash01(c.seed + i * 5) - 0.5) * u * 1.2;
        const ey = y - u * (0.05 + 0.25 * hash01(c.seed + i * 9));
        const bp = (t * (0.25 + 0.2 * hash01(i)) + hash01(i * 3)) % 1;
        const open = bp < 0.85 ? 1 : Math.abs(Math.cos(((bp - 0.85) / 0.15) * Math.PI));
        const er = u * 0.008;
        const col = i % 2 ? '#fff066' : '#b6ff4d';
        addGlow(g, ex, ey, er * 6, col, 0.3);
        g.fillStyle = col;
        for (const sd of [-1, 1]) {
          g.beginPath();
          g.ellipse(ex + sd * er * 2.2, ey, er, er * open, 0, 0, TAU);
          g.fill();
        }
      }
      break;
    case 'pumpkinPatch':
      for (let i = 0; i < 7; i++) {
        const row = i % 2;
        const px = x + (i - 3) * u * 0.18 + (row ? u * 0.05 : 0);
        if (Math.abs(px - x) < u * 0.08) continue;
        const py = y + u * (0.03 + row * 0.04);
        pumpkin(g, px, py, u * (0.07 + 0.03 * hash01(c.seed + i)), {
          pal,
          face: (i + c.seed) % 6,
          t: t + i,
          glow: 0.85,
        });
      }
      break;
    case 'cauldron': {
      const r = u * 0.13;
      fire(g, x, y - r * 0.05, r * 0.9, t, c.seed);
      // glowing brew + bubbles + steam
      addGlow(g, x, y - r * 1.9, r * 1.6, '#7dff6a', 0.45 + 0.1 * Math.sin(t * 2));
      g.fillStyle = '#7dff6a';
      g.beginPath();
      g.ellipse(x, y - r * 1.88, r * 1.02, r * 0.16, 0, 0, TAU);
      g.fill();
      for (let i = 0; i < 6; i++) {
        const ph = (t * 0.6 + hash01(i * 7)) % 1;
        const bx = x + (hash01(i * 13) - 0.5) * r * 1.4 + Math.sin(t * 2 + i) * r * 0.1;
        const by = y - r * 1.9 - ph * r * 2.4;
        g.globalAlpha = 1 - ph;
        g.strokeStyle = '#b6ff9a';
        g.lineWidth = Math.max(1, r * 0.03);
        g.beginPath();
        g.arc(bx, by, r * (0.06 + 0.08 * ph), 0, TAU);
        g.stroke();
        g.globalAlpha = 1;
      }
      break;
    }
    case 'bonfire': {
      fire(g, x, y - u * 0.02, u * 0.22, t, c.seed);
      for (let i = 0; i < 10; i++) {
        const ph = (t * 0.5 + hash01(i * 3)) % 1;
        addGlow(
          g,
          x + Math.sin(t + i) * u * 0.1 * ph,
          y - u * (0.15 + ph * 0.5),
          u * 0.012,
          '#ffc35a',
          1 - ph,
        );
      }
      const beat = (t * 100) / 60;
      for (const sd of [-1, 1]) {
        const size = u * 0.4;
        skeleton(
          g,
          x + sd * u * 0.36,
          y - size / 2 + u * 0.02,
          size,
          dancePose(beat + (sd > 0 ? 0.5 : 0), sd > 0 ? 1 : 2),
          pal.ghost,
          pal.party[sd > 0 ? 1 : 2],
        );
      }
      break;
    }
    case 'stage': {
      const beat = (t * 108) / 60;
      // disco ball + light beams
      const bx = x;
      const by = y - u * 0.6;
      const br = u * 0.05;
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 2 + Math.sin(t * 0.8 + i) * 0.9;
        const col = pal.party[i % pal.party.length]!;
        const gr = g.createLinearGradient(bx, by, bx + Math.cos(a) * u, by + Math.sin(a) * u);
        gr.addColorStop(0, col);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = 0.18;
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(bx + Math.cos(a - 0.08) * u, by + Math.sin(a - 0.08) * u);
        g.lineTo(bx + Math.cos(a + 0.08) * u, by + Math.sin(a + 0.08) * u);
        g.closePath();
        g.fill();
        g.globalAlpha = 1;
      }
      const ball = g.createRadialGradient(bx - br * 0.3, by - br * 0.3, br * 0.1, bx, by, br);
      ball.addColorStop(0, '#ffffff');
      ball.addColorStop(1, '#5a5f7a');
      g.fillStyle = ball;
      g.beginPath();
      g.arc(bx, by, br, 0, TAU);
      g.fill();
      for (let i = 0; i < 4; i++) {
        const size = u * 0.42;
        const sx = x + (i - 1.5) * u * 0.34;
        skeleton(
          g,
          sx,
          y - u * 0.06 - size / 2,
          size,
          dancePose(beat + (i % 2) * 0.5, (i + Math.floor(beat / 8)) % 4),
          pal.ghost,
          pal.party[i % pal.party.length],
        );
      }
      break;
    }
  }
  void ghost;
}
