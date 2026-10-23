import { polygonBBox, type Output, type SessionState, type Viewport } from '@spectrastage/shared';

const KIND_COLOR: Record<string, string> = { wall: '#ffb347', floor: '#5ad1ff', other: '#c39bff' };

/** Calibration pattern in stage space: 0.5 m grid, surface outlines and labels, viewport frame. */
export function drawStageGrid(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  vp: Viewport,
  state: SessionState,
  output: Output | null,
  focus: number | null = null,
  now = 0,
): void {
  const ppm = w / vp.w;
  const tx = (x: number) => (x - vp.x) * ppm;
  const ty = (y: number) => (y - vp.y) * ppm;
  g.save();
  g.lineWidth = 1;
  // Grid every 0.5 m, major every 1 m
  const step = 0.5;
  for (let x = Math.ceil(vp.x / step) * step; x <= vp.x + vp.w; x += step) {
    const major = Math.abs(x - Math.round(x)) < 1e-6;
    g.strokeStyle = major ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.moveTo(tx(x), 0);
    g.lineTo(tx(x), h);
    g.stroke();
  }
  for (let y = Math.ceil(vp.y / step) * step; y <= vp.y + vp.h; y += step) {
    const major = Math.abs(y - Math.round(y)) < 1e-6;
    g.strokeStyle = major ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.moveTo(0, ty(y));
    g.lineTo(w, ty(y));
    g.stroke();
  }
  // Surfaces
  const font = Math.max(14, Math.round(w / 45));
  for (const s of state.surfaces) {
    const color = KIND_COLOR[s.kind] ?? '#fff';
    g.strokeStyle = color;
    g.lineWidth = Math.max(3, w / 300);
    g.beginPath();
    s.polygon.forEach((p, i) => (i === 0 ? g.moveTo(tx(p.x), ty(p.y)) : g.lineTo(tx(p.x), ty(p.y))));
    g.closePath();
    g.stroke();
    g.fillStyle = color.replace(')', ', 0.12)').replace('#', '#');
    g.globalAlpha = 0.12;
    g.fillStyle = color;
    g.fill();
    g.globalAlpha = 1;
    const b = polygonBBox(s.polygon);
    g.fillStyle = color;
    g.font = `bold ${font}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s.name, tx(b.x + b.w / 2), ty(b.y + b.h / 2));
    g.font = `${Math.round(font * 0.6)}px sans-serif`;
    g.fillText(`${b.w.toFixed(2)} × ${b.h.toFixed(2)} m`, tx(b.x + b.w / 2), ty(b.y + b.h / 2) + font);
  }
  // Viewport frame with numbered corners
  g.strokeStyle = '#ffffff';
  g.lineWidth = Math.max(4, w / 200);
  g.strokeRect(2, 2, w - 4, h - 4);
  const r = Math.max(18, w / 40);
  const corners: [number, number][] = [
    [r * 1.4, r * 1.4],
    [w - r * 1.4, r * 1.4],
    [w - r * 1.4, h - r * 1.4],
    [r * 1.4, h - r * 1.4],
  ];
  corners.forEach(([x, y], i) => {
    if (focus === i) {
      // Pulsing target rings around the corner being adjusted on the phone
      const t = (now % 1000) / 1000;
      g.strokeStyle = ['#ff4d4d', '#4dff88', '#4da6ff', '#ffe14d'][i]!;
      g.lineWidth = Math.max(4, r / 4);
      for (const k of [0, 0.5]) {
        const f = (t + k) % 1;
        g.globalAlpha = 1 - f;
        g.beginPath();
        g.arc(x, y, r * (1.2 + f * 2.2), 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(i === 0 || i === 3 ? 0 : w, y);
      g.moveTo(x, y);
      g.lineTo(x, i < 2 ? 0 : h);
      g.stroke();
    }
    g.fillStyle = ['#ff4d4d', '#4dff88', '#4da6ff', '#ffe14d'][i]!;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#000';
    g.font = `bold ${Math.round(r * 1.1)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i + 1), x, y + 1);
  });
  // Center cross
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(w / 2 - r, h / 2);
  g.lineTo(w / 2 + r, h / 2);
  g.moveTo(w / 2, h / 2 - r);
  g.lineTo(w / 2, h / 2 + r);
  g.stroke();
  if (output) {
    g.fillStyle = '#fff';
    g.font = `bold ${font}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText(output.name, w / 2, r * 0.6);
  }
  g.restore();
}

/** Raw output-space pattern (ignores calibration): checkerboard, border, numbered corners. */
export function drawRawPattern(g: CanvasRenderingContext2D, w: number, h: number, label: string): void {
  g.save();
  const cell = Math.max(20, Math.round(Math.min(w, h) / 12));
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      g.fillStyle = ((x / cell + y / cell) & 1) === 0 ? '#2a2a2a' : '#5a5a5a';
      g.fillRect(x, y, cell, cell);
    }
  }
  g.strokeStyle = '#fff';
  g.lineWidth = 6;
  g.strokeRect(3, 3, w - 6, h - 6);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(w, h);
  g.moveTo(w, 0);
  g.lineTo(0, h);
  g.stroke();
  const r = Math.max(20, w / 36);
  [
    [r * 1.5, r * 1.5],
    [w - r * 1.5, r * 1.5],
    [w - r * 1.5, h - r * 1.5],
    [r * 1.5, h - r * 1.5],
  ].forEach(([x, y], i) => {
    g.fillStyle = ['#ff4d4d', '#4dff88', '#4da6ff', '#ffe14d'][i]!;
    g.beginPath();
    g.arc(x!, y!, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#000';
    g.font = `bold ${Math.round(r)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i + 1), x!, y! + 1);
  });
  g.fillStyle = '#fff';
  g.font = `bold ${Math.round(w / 30)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`${label}  ${w}×${h}`, w / 2, h / 2);
  g.restore();
}

export function drawIdentify(g: CanvasRenderingContext2D, w: number, h: number, label: string): void {
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(0, h * 0.3, w, h * 0.4);
  g.fillStyle = '#ffcf33';
  g.font = `bold ${Math.round(h / 7)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, w / 2, h / 2);
  g.restore();
}
