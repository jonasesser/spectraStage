import type { ThemeManifest } from '@spectrastage/shared';

const L = (en: string, de: string) => ({ en, de });

/** Neutral theme: proves the core is theme-independent and is useful for any occasion. */
export const basicManifest: ThemeManifest = {
  id: 'basic',
  version: '1.0.0',
  name: L('Ambient Basics', 'Ambient-Basis'),
  description: L('Neutral calm visuals for any occasion.', 'Neutrale ruhige Visuals für jeden Anlass.'),
  icon: '🌈',
  rating: 'family',
  scenes: [
    {
      id: 'aurora',
      name: L('Aurora', 'Polarlicht'),
      description: L('Flowing northern lights (shader).', 'Fließendes Polarlicht (Shader).'),
      kinds: ['wall', 'floor', 'other'],
      icon: '🌌',
      colors: ['#031b2b', '#4dffb5'],
      params: [
        { key: 'speed', label: L('Speed', 'Tempo'), type: 'number', min: 0.2, max: 2, step: 0.1, default: 1 },
        { key: 'color', label: L('Color', 'Farbe'), type: 'color', default: '#4dffb5' },
      ],
    },
    {
      id: 'starfield',
      name: L('Starfield', 'Sternenhimmel'),
      description: L('Twinkling stars and shooting stars.', 'Funkelnde Sterne und Sternschnuppen.'),
      kinds: ['wall', 'floor', 'other'],
      icon: '⭐',
      colors: ['#05060f', '#c8d6ff'],
      params: [
        {
          key: 'density',
          label: L('Density', 'Dichte'),
          type: 'number',
          min: 0.2,
          max: 2,
          step: 0.1,
          default: 1,
        },
      ],
    },
    {
      id: 'colorWaves',
      name: L('Color Waves', 'Farbwellen'),
      description: L('Slow soft gradients.', 'Langsame weiche Farbverläufe.'),
      kinds: ['wall', 'floor', 'other'],
      icon: '🌊',
      colors: ['#2a0b4a', '#ff6fa8'],
      params: [
        {
          key: 'speed',
          label: L('Speed', 'Tempo'),
          type: 'number',
          min: 0.1,
          max: 2,
          step: 0.1,
          default: 0.6,
        },
        { key: 'colorA', label: L('Color A', 'Farbe A'), type: 'color', default: '#3a1c71' },
        { key: 'colorB', label: L('Color B', 'Farbe B'), type: 'color', default: '#ffaf7b' },
      ],
    },
    {
      id: 'solidColor',
      name: L('Solid Color', 'Vollfarbe'),
      description: L('A single calm color (useful for testing).', 'Eine ruhige Farbe (nützlich zum Testen).'),
      kinds: ['wall', 'floor', 'other'],
      icon: '🟪',
      colors: ['#333', '#888'],
      params: [{ key: 'color', label: L('Color', 'Farbe'), type: 'color', default: '#202040' }],
    },
  ],
  effects: [
    {
      id: 'pulse',
      name: L('Soft Pulse', 'Sanfter Puls'),
      icon: '💫',
      durationMs: 2500,
      cooldownMs: 800,
      childSafe: true,
      kinds: ['wall', 'floor', 'other'],
    },
    {
      id: 'shootingStars',
      name: L('Shooting Stars', 'Sternschnuppen'),
      icon: '🌠',
      durationMs: 4000,
      cooldownMs: 800,
      childSafe: true,
      kinds: ['wall', 'floor', 'other'],
    },
  ],
  actors: [
    {
      id: 'firefly',
      name: L('Firefly', 'Glühwürmchen'),
      icon: '🟡',
      kinds: ['wall', 'floor', 'other'],
      sizeM: 0.15,
      speedMps: 0.6,
      pauseSec: [0, 0.6],
      waypoints: [4, 7],
      childSafe: true,
    },
  ],
  presets: [
    {
      id: 'calm',
      name: L('Calm', 'Ruhig'),
      description: L('Aurora on walls, stars on the ground.', 'Polarlicht an Wänden, Sterne am Boden.'),
      icon: '😌',
      assignments: { wall: { sceneId: 'aurora' }, floor: { sceneId: 'starfield' } },
      ambientActors: ['firefly'],
    },
  ],
  playlistTemplates: [
    {
      id: 'ambientLoop',
      name: L('Ambient loop', 'Ambient-Schleife'),
      kind: 'wall',
      loop: true,
      items: [
        { sceneId: 'aurora', durationSec: 180, transition: { type: 'crossfade', durationMs: 4000 } },
        { sceneId: 'colorWaves', durationSec: 180, transition: { type: 'crossfade', durationMs: 4000 } },
        {
          sceneId: 'starfield',
          durationSec: 180,
          transition: { type: 'crossfade', durationMs: 4000 },
          ambient: { effectIds: ['shootingStars'], minGapSec: 15, maxGapSec: 40 },
        },
      ],
    },
  ],
  starterStage: [{ name: L('Wall', 'Wand'), kind: 'wall' }],
  defaults: { wall: 'aurora', floor: 'starfield', other: 'colorWaves' },
};
