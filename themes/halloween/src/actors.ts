import type { ActorModule } from '@spectrastage/engine';
import { BOOST_RIM, PALETTES } from './palette.ts';
import { bat, cat, fuzzySpider, ghost, withRim } from './shapes.ts';

const pal = PALETTES.classic!;

/** Dusk boost 0..1 from the engine (older engines don't send it). */
function boostOf(info: object): number {
  const b = (info as { boost?: number }).boost;
  return typeof b === 'number' && Number.isFinite(b) ? Math.max(0, Math.min(1, b)) : 0;
}

const spiderActor: ActorModule = {
  id: 'spider',
  draw(g, pose, info) {
    // Legs cycle with distance walked (≈ 6 steps per body length), still while resting.
    const phase = (pose.distance / Math.max(0.05, 0.45)) * Math.PI * 4;
    const boost = boostOf(info);
    fuzzySpider(
      g,
      info.sizePx,
      phase,
      Math.max(0.15, boost),
      boost > 0 ? BOOST_RIM : pal.rim,
      '#ffe14d',
      info.seed,
    );
  },
  sound(snd) {
    snd.scuttle({ duration: 0.7, gain: 0.035 });
  },
};

const batActor: ActorModule = {
  id: 'bat',
  upright: true,
  draw(g, pose, info) {
    const mirror = Math.cos(pose.angle) < 0;
    const boost = boostOf(info);
    g.save();
    if (mirror) g.scale(-1, 1);
    g.rotate(Math.max(-0.4, Math.min(0.4, Math.sin(pose.angle) * 0.4)) * (mirror ? -1 : 1));
    const size = info.sizePx * 1.4;
    withRim(g, size, boost, BOOST_RIM, () => bat(g, 0, 0, size, Math.sin(info.t * 15 + info.seed), pal));
    g.restore();
  },
  sound(snd) {
    snd.flutter({ duration: 0.8, gain: 0.06, rate: 15 });
  },
};

const ghostActor: ActorModule = {
  id: 'ghost',
  upright: true,
  draw(g, pose, info) {
    const bob = Math.sin(info.t * 2.2 + info.seed) * info.sizePx * 0.06;
    ghost(g, 0, bob, info.sizePx, {
      color: pal.ghost,
      t: info.t,
      face: pose.moving ? 'happy' : 'oo',
      wave: pose.moving ? 0.2 : Math.sin(info.t * 6) * 0.8,
      mirror: Math.cos(pose.angle) < 0,
      blush: '#ff9ac8',
      glow: 1 + boostOf(info),
    });
  },
};

const catActor: ActorModule = {
  id: 'blackCat',
  upright: true,
  draw(g, pose, info) {
    const boost = boostOf(info);
    const size = info.sizePx * 1.3;
    g.save();
    if (Math.cos(pose.angle) < 0) g.scale(-1, 1);
    withRim(g, size, boost, BOOST_RIM, () =>
      cat(g, size, (pose.distance / 0.25) * Math.PI, pose.moving, info.t + info.seed, pal),
    );
    g.restore();
  },
};

export const actors: ActorModule[] = [spiderActor, batActor, ghostActor, catActor];
