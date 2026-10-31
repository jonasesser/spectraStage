import { useEffect, useRef } from 'react';
import { catalog } from '@spectrastage/catalog/manifests';
import { loadThemeRuntime } from '@spectrastage/catalog/runtime';
import { StageRenderer } from '@spectrastage/engine';
import { ghostImagesFor } from '../lib/ghostImages.ts';
import { downloadBlob, stamp } from '../lib/guestPhotos.ts';
import { useStore } from './store.ts';
import {
  activeProfile,
  completeRoom,
  faceWall,
  roomFold,
  stageBounds,
  type BBox,
  type Profile,
  type RoomWall,
  type SessionState,
} from '@spectrastage/shared';

/**
 * Renders the show on this device with the same engine the projectors use.
 * - Without outputId: the whole stage (all surfaces, no calibration).
 * - With outputId: exactly what that projector would show (viewport, keystone, masks, blackout).
 *   An optional unsaved profile (calibration draft) can be previewed.
 */
export function StagePreview({
  state,
  now,
  outputId,
  profile,
  side,
  snapshot,
}: {
  state: SessionState;
  now: () => number;
  outputId?: string;
  profile?: Profile | null;
  /** Show only this side of the room (also the ones the app adds itself, e.g. the floor). */
  side?: RoomWall | null;
  /** Offer a button that saves the current picture (label of the button). */
  snapshot?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const r = useRef<StageRenderer | null>(null);
  const store = useStore();
  useEffect(() => {
    if (!ref.current) return;
    const renderer = new StageRenderer({
      canvas: ref.current,
      catalog,
      loadRuntime: loadThemeRuntime,
      now,
      preview: !outputId,
      maxPixelRatio: 1,
      // the picture can be saved (download as a souvenir)
      readable: !!snapshot,
    });
    r.current = renderer;
    renderer.setGhostImages(ghostImagesFor(store.conn).get);
    renderer.start();
    return () => renderer.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputId]);
  useEffect(() => {
    r.current?.setState(state, outputId ?? null);
  }, [state, outputId]);
  useEffect(() => {
    r.current?.setPreviewProfile(profile ?? null);
  }, [profile]);
  // one side only: its rect in the (complete) room
  let sideRect: BBox | null = null;
  if (side && !outputId) {
    const fold = roomFold(state.surfaces);
    const f = fold.faces.find((x) => faceWall(fold, x) === side);
    if (f) sideRect = f.rect;
  }
  const sideKey = sideRect ? `${sideRect.x},${sideRect.y},${sideRect.w},${sideRect.h}` : '';
  useEffect(() => {
    const rr = r.current;
    if (!rr) return;
    if (!sideRect) return rr.setPreviewViewport(null);
    const m = Math.min(sideRect.w, sideRect.h) * 0.03;
    rr.setPreviewViewport({
      x: sideRect.x - m,
      y: sideRect.y - m,
      w: sideRect.w + 2 * m,
      h: sideRect.h + 2 * m,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideKey]);

  const output = outputId ? state.outputs.find((o) => o.id === outputId) : undefined;
  const res = output ? (activeProfile(output).referenceResolution ?? output.resolutionMismatch) : null;
  let aspect = res ? `${res.w} / ${res.h}` : '16 / 9';
  if (sideRect) aspect = `${sideRect.w} / ${sideRect.h}`;
  else if (!outputId && state.surfaces.length > 0) {
    // Whole-stage preview: follow the stage's shape (portrait stages on phones stay large).
    const b = stageBounds(completeRoom(state.surfaces));
    aspect = String(Math.min(2.4, Math.max(0.6, b.w / b.h)));
  }
  const canvas = <canvas ref={ref} className="preview-canvas" style={{ aspectRatio: aspect }} />;
  if (!snapshot) return canvas;
  return (
    <div className="stack" style={{ gap: '0.4rem' }}>
      {canvas}
      <div className="row">
        <button
          className="btn small"
          onClick={() =>
            ref.current?.toBlob((b) => {
              if (b) downloadBlob(b, `spectrastage-szene_${side ?? 'raum'}_${stamp(Date.now())}.png`);
            }, 'image/png')
          }
        >
          📷 {snapshot}
        </button>
      </div>
    </div>
  );
}
