import type { ActorModule } from '@spectrastage/engine';
import { PALETTES } from './palette.ts';
import { bat, cat, ghost, spider } from './shapes.ts';

const pal = PALETTES.classic!;

const spiderActor: ActorModule = {
  id: 'spider',
  draw(g, pose, info) {
    // Legs cycle with distance walked (≈ 6 steps per body length), still while resting.
    const phase = (pose.distance / Math.max(0.05, 0.45)) * Math.PI * 4;
    spider(g, info.sizePx, phase, pal);
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
    g.save();
    if (mirror) g.scale(-1, 1);
    g.rotate(Math.max(-0.4, Math.min(0.4, Math.sin(pose.angle) * 0.4)) * (mirror ? -1 : 1));
    bat(g, 0, 0, info.sizePx * 1.4, Math.sin(info.t * 15 + info.seed), pal);
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
    });
  },
};

const catActor: ActorModule = {
  id: 'blackCat',
  upright: true,
  draw(g, pose, info) {
    g.save();
    if (Math.cos(pose.angle) < 0) g.scale(-1, 1);
    cat(g, info.sizePx * 1.3, (pose.distance / 0.25) * Math.PI, pose.moving, info.t + info.seed, pal);
    g.restore();
  },
};

export const actors: ActorModule[] = [spiderActor, batActor, ghostActor, catActor];
