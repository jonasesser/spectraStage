import { useEffect, useRef } from 'react';
import { catalog } from '@spectrastage/catalog/manifests';
import { loadThemeRuntime } from '@spectrastage/catalog/runtime';
import { StageRenderer } from '@spectrastage/engine';
import { ghostImagesFor } from '../lib/ghostImages.ts';
import { useStore } from './store.ts';
import { activeProfile, stageBounds, type Profile, type SessionState } from '@spectrastage/shared';

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
}: {
  state: SessionState;
  now: () => number;
  outputId?: string;
  profile?: Profile | null;
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

  const output = outputId ? state.outputs.find((o) => o.id === outputId) : undefined;
  const res = output ? (activeProfile(output).referenceResolution ?? output.resolutionMismatch) : null;
  let aspect = res ? `${res.w} / ${res.h}` : '16 / 9';
  if (!outputId && state.surfaces.length > 0) {
    // Whole-stage preview: follow the stage's shape (portrait stages on phones stay large).
    const b = stageBounds(state.surfaces);
    aspect = String(Math.min(2.4, Math.max(0.6, b.w / b.h)));
  }
  return <canvas ref={ref} className="preview-canvas" style={{ aspectRatio: aspect }} />;
}
