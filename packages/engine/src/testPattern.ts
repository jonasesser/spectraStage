import {
  cornerWalls,
  facePoint,
  faceWall,
  ROOM_WALL_LABEL,
  wallQuads,
  type RoomWall,
  objectEdges,
  polygonBBox,
  projectPose,
  roomCorners,
  roomEdges,
  type Anchor,
  type Output,
  type Pose,
  type RoomFold,
  type RoomObject,
  type SessionState,
  type V3,
  type Viewport,
} from '@spectrastage/shared';

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
  frame = true,
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
  if (frame) drawCornerMarkers(g, w, h, focus, now);
  const r = Math.max(18, w / 40);
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

/** White image frame with the numbered, colored corners (1–4) used by the fine adjustment. */
export function drawCornerMarkers(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  focus: number | null = null,
  now = 0,
): void {
  g.save();
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
  g.restore();
}

/**
 * Corner measuring on the projector: the room edges and numbered room corners as the app
 * currently thinks they lie (from the projector pose), plus the measured markers. When the
 * glowing lines lie on the real room edges, the projector is aligned.
 */
export function drawAlignOverlay(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  pose: Pose,
  fold: RoomFold,
  anchors: readonly Anchor[],
  sel: string | null,
  now: number,
  walls: readonly RoomWall[] = [],
): void {
  const aspect = w / h;
  const quads = walls.length ? wallQuads(fold, pose, aspect, anchors, walls) : [];
  const toPx = (P: V3): [number, number] | null => {
    const q = projectPose(pose, aspect, P);
    return q ? [((q[0] + 1) / 2) * w, ((1 - q[1]) / 2) * h] : null;
  };
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 0, w, h);
  const lw = Math.max(2, w / 640);
  // room edges
  g.strokeStyle = '#3ff2ff';
  g.lineWidth = lw;
  g.shadowColor = '#3ff2ff';
  g.shadowBlur = lw * 3;
  // chosen sides: exactly where they are pinned (measured corners), straight lines between them
  for (const q of quads) {
    g.beginPath();
    q.uv.forEach(([u, v], i) => (i ? g.lineTo(u * w, v * h) : g.moveTo(u * w, v * h)));
    g.closePath();
    g.stroke();
  }
  for (const f of quads.length || walls.length ? [] : fold.faces) {
    const r = f.rect;
    const edges: [number, number, number, number][] = [
      [r.x, r.y, r.x + r.w, r.y],
      [r.x + r.w, r.y, r.x + r.w, r.y + r.h],
      [r.x + r.w, r.y + r.h, r.x, r.y + r.h],
      [r.x, r.y + r.h, r.x, r.y],
    ];
    for (const [x0, y0, x1, y1] of edges) {
      g.beginPath();
      let pen = false;
      for (let i = 0; i <= 48; i++) {
        const t = i / 48;
        const q = toPx(facePoint(f, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t));
        if (!q || q[0] < -w || q[0] > 2 * w || q[1] < -h || q[1] > 2 * h) {
          pen = false;
          continue;
        }
        if (pen) g.lineTo(q[0], q[1]);
        else g.moveTo(q[0], q[1]);
        pen = true;
      }
      g.stroke();
    }
  }
  // the edge being measured: thick orange
  const selEdge = sel?.startsWith('e|') ? sel.slice(2, sel.lastIndexOf('|')) : null;
  const edge = selEdge ? roomEdges(fold).find((e) => e.id === selEdge) : undefined;
  if (edge) {
    g.strokeStyle = '#ffb347';
    g.shadowColor = '#ffb347';
    g.lineWidth = lw * 2.5;
    g.beginPath();
    let pen = false;
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      const q = toPx([
        edge.a[0] + (edge.b[0] - edge.a[0]) * t,
        edge.a[1] + (edge.b[1] - edge.a[1]) * t,
        edge.a[2] + (edge.b[2] - edge.a[2]) * t,
      ]);
      if (!q || q[0] < -w || q[0] > 2 * w || q[1] < -h || q[1] > 2 * h) {
        pen = false;
        continue;
      }
      if (pen) g.lineTo(q[0], q[1]);
      else g.moveTo(q[0], q[1]);
      pen = true;
    }
    g.stroke();
  }
  g.shadowBlur = 0;
  // the names of the sides (Vorne, Links …) in their middle
  {
    const fsl = Math.max(18, h / 16);
    g.font = `800 ${fsl}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const labels: { name: string; x: number; y: number }[] = quads.map((q) => ({
      name: ROOM_WALL_LABEL[q.wall],
      x: (q.uv.reduce((s, p) => s + p[0], 0) / 4) * w,
      y: (q.uv.reduce((s, p) => s + p[1], 0) / 4) * h,
    }));
    if (!quads.length)
      for (const f of fold.faces) {
        const wl = faceWall(fold, f);
        const c = toPx(facePoint(f, f.rect.x + f.rect.w / 2, f.rect.y + f.rect.h / 2));
        if (wl && c) labels.push({ name: ROOM_WALL_LABEL[wl], x: c[0], y: c[1] });
      }
    for (const l of labels) {
      if (l.x < 0 || l.x > w || l.y < 0 || l.y > h) continue;
      g.fillStyle = 'rgba(63,242,255,0.55)';
      g.fillText(l.name.toUpperCase(), l.x, l.y);
    }
  }
  // numbered room corners (where the app thinks they are)
  const fs = Math.max(14, h / 28);
  g.font = `700 ${fs}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const onWall = (id: string) => !walls.length || cornerWalls(id).some((x) => walls.includes(x));
  // numbered 1, 2, 3 … only over the corners of this projector's sides
  const corners = roomCorners(fold)
    .filter((c) => onWall(c.id))
    .map((c, i) => ({ ...c, n: i + 1 }));
  for (const c of corners) {
    if (!onWall(c.id)) continue;
    const pinned = quads
      .map((qd) => qd.keys.indexOf(c.id) >= 0 && qd.uv[qd.keys.indexOf(c.id)]!)
      .find((x) => !!x);
    const q: [number, number] | null = pinned ? [pinned[0] * w, pinned[1] * h] : toPx(c.p);
    if (!q || q[0] < 0 || q[0] > w || q[1] < 0 || q[1] > h) continue;
    const isSel = c.id === sel;
    g.fillStyle = isSel ? '#ffb347' : '#3ff2ff';
    g.beginPath();
    g.arc(q[0], q[1], fs * 0.25, 0, Math.PI * 2);
    g.fill();
    const lx = Math.min(w - fs, Math.max(fs, q[0] + (q[0] < w / 2 ? fs : -fs)));
    const ly = Math.min(h - fs, Math.max(fs, q[1] + (q[1] < h / 2 ? fs : -fs)));
    g.fillText(String(c.n), lx, ly);
  }
  // measured markers: big crosshairs (the selected one pulses)
  for (const a of anchors) {
    const x = a.u * w;
    const y = a.v * h;
    const isSel = a.c === sel;
    const s = fs * (isSel ? 1.6 + 0.2 * Math.sin(now / 150) : 1.1);
    g.strokeStyle = isSel ? '#ffb347' : '#7dff8a';
    g.lineWidth = lw * (isSel ? 1.6 : 1.2);
    g.beginPath();
    g.moveTo(x - s, y);
    g.lineTo(x - s * 0.25, y);
    g.moveTo(x + s * 0.25, y);
    g.lineTo(x + s, y);
    g.moveTo(x, y - s);
    g.lineTo(x, y - s * 0.25);
    g.moveTo(x, y + s * 0.25);
    g.lineTo(x, y + s);
    g.stroke();
    g.beginPath();
    g.arc(x, y, s * 0.6, 0, Math.PI * 2);
    g.stroke();
    const c = corners.find((k) => k.id === a.c);
    if (c) {
      g.fillStyle = g.strokeStyle;
      g.fillText(String(c.n), x + s * 1.2, y - s * 1.0);
    }
  }
  g.restore();
}

/** Outline of an object being placed: shown on every projector so it can be lined up live. */
export function drawObjectOutline(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  pose: Pose,
  o: RoomObject,
  now: number,
): void {
  const aspect = w / h;
  const toPx = (P: V3): [number, number] | null => {
    const q = projectPose(pose, aspect, P);
    return q ? [((q[0] + 1) / 2) * w, ((1 - q[1]) / 2) * h] : null;
  };
  g.save();
  const lw = Math.max(2, w / 500);
  g.strokeStyle = `rgba(255, 230, 80, ${0.75 + 0.25 * Math.sin(now / 160)})`;
  g.lineWidth = lw;
  g.shadowColor = '#ffe650';
  g.shadowBlur = lw * 3;
  g.beginPath();
  for (const [a, b] of objectEdges(o)) {
    const p = toPx(a);
    const q = toPx(b);
    if (!p || !q) continue;
    g.moveTo(p[0], p[1]);
    g.lineTo(q[0], q[1]);
  }
  g.stroke();
  g.restore();
}
