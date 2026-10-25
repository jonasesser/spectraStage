import { useEffect, useRef, useState } from 'react';
import { catalog } from '@spectrastage/catalog/manifests';
import { loadThemeRuntime } from '@spectrastage/catalog/runtime';
import { StageRenderer } from '@spectrastage/engine';
import { worldLayout, type SessionState } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { ZombieFx } from '../display/zombie.ts';
import { ghostImagesFor } from '../lib/ghostImages.ts';
import { useStore } from './store.ts';

/**
 * Try the zombie camera without a projector: the same effect runs on this phone and the result
 * is shown on the front wall of a preview of the show – exactly like the projector would.
 */
export function ZombiePreview({
  state,
  now,
  video,
  style,
  capture,
  L,
}: {
  state: SessionState;
  now: () => number;
  video: HTMLVideoElement | null;
  style: 'makeup' | 'comic';
  /** Take ghost photos here (testing without a projector). */
  capture: boolean;
  L: Tr;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const store = useStore();
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const rRef = useRef<StageRenderer | null>(null);
  const fxRef = useRef<ZombieFx | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    if (!ref.current || !video) return;
    const r = new StageRenderer({
      canvas: ref.current,
      catalog,
      loadRuntime: loadThemeRuntime,
      now,
      preview: true,
      maxPixelRatio: 2,
    });
    rRef.current = r;
    r.setGhostImages(ghostImagesFor(store.conn).get);
    const fx = new ZombieFx();
    fx.style = style;
    fx.onCapture = (image, u) => {
      if (!captureRef.current) return;
      void fetch('/api/ghosts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${store.conn.authToken}` },
        body: JSON.stringify({ image, u, release: true }),
      }).catch(() => {});
    };
    fxRef.current = fx;
    let last = performance.now();
    r.setLiveSprite(() => {
      const t = performance.now();
      const dt = Math.min(0.5, (t - last) / 1000);
      last = t;
      return fx.ready ? fx.sprites(dt, true) : [];
    });
    r.start();
    let timer = 0;
    let alive = true;
    void fx.init().then(() => {
      if (!alive) return;
      setStatus(fx.ready ? 'ready' : 'failed');
      timer = window.setInterval(() => {
        try {
          fx.process(video, performance.now());
        } catch {
          /* skip */
        }
      }, 90);
    });
    return () => {
      alive = false;
      window.clearInterval(timer);
      r.setLiveSprite(null);
      r.dispose();
      fx.dispose();
      rRef.current = null;
      fxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video]);

  useEffect(() => {
    if (fxRef.current) fxRef.current.style = style;
  }, [style]);

  // show the front wall (main wall) with a little room around it
  const main = worldLayout(state.surfaces).find((w) => w.role === 'main');
  useEffect(() => {
    const r = rRef.current;
    if (!r) return;
    r.setState(state, null);
    if (main) {
      const m = main.rect;
      r.setPreviewViewport({ x: m.x - m.w * 0.02, y: m.y - m.h * 0.02, w: m.w * 1.04, h: m.h * 1.04 });
    }
  }, [state, main?.rect.x, main?.rect.y, main?.rect.w, main?.rect.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const aspect = main ? `${main.rect.w} / ${main.rect.h}` : '16 / 9';
  return (
    <div className="stack" style={{ gap: '0.3rem' }}>
      <canvas ref={ref} className="preview-canvas" style={{ aspectRatio: aspect }} />
      <span className="small muted">
        {status === 'loading'
          ? L(
              'Loading the zombie effect (about 15 MB, once)…',
              'Lade den Zombie-Effekt (ca. 15 MB, einmalig) …',
            )
          : status === 'failed'
            ? L('The effect cannot run in this browser.', 'Der Effekt läuft in diesem Browser nicht.')
            : L(
                'Preview on this phone – the projector shows the same.',
                'Vorschau auf diesem Handy – der Beamer zeigt dasselbe.',
              )}
      </span>
    </div>
  );
}
