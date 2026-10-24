import type { EffectManifest, ParamDef, SceneManifest, ThemeManifest } from '@spectrastage/shared';

const L = (en: string, de: string) => ({ en, de });

export const MOOD_OPTIONS = [
  { value: 'classic', label: L('Classic orange', 'Klassisch Orange') },
  { value: 'violet', label: L('Violet night', 'Violette Nacht') },
  { value: 'green', label: L('Witchy green', 'Hexengrün') },
  { value: 'blue', label: L('Moonlight blue', 'Mondlicht Blau') },
  { value: 'neon', label: L('Neon (bright for dusk)', 'Neon (hell für Dämmerung)') },
];

const common: ParamDef[] = [
  { key: 'density', label: L('Density', 'Dichte'), type: 'number', min: 0.2, max: 2, step: 0.1, default: 1 },
  { key: 'speed', label: L('Speed', 'Tempo'), type: 'number', min: 0.2, max: 2, step: 0.1, default: 1 },
  {
    key: 'mood',
    label: L('Color mood', 'Farbstimmung'),
    type: 'select',
    options: MOOD_OPTIONS,
    default: 'classic',
  },
];

function scene(
  id: string,
  name: [string, string],
  description: [string, string],
  kinds: SceneManifest['kinds'],
  icon: string,
  colors: [string, string],
  extra: ParamDef[] = [],
): SceneManifest {
  return {
    id,
    name: L(...name),
    description: L(...description),
    kinds,
    icon,
    colors,
    params: [...common, ...extra],
  };
}

/** Neon scenes: same params, but the color mood defaults to 'neon'. */
function neonScene(
  id: string,
  name: [string, string],
  description: [string, string],
  kinds: SceneManifest['kinds'],
  icon: string,
  colors: [string, string],
  extra: ParamDef[] = [],
): SceneManifest {
  const sc = scene(id, name, description, kinds, icon, colors, extra);
  sc.params = sc.params.map((p) => (p.key === 'mood' && p.type === 'select' ? { ...p, default: 'neon' } : p));
  return sc;
}

const EVENT_OPTIONS = [
  { value: 'mix', label: L('Mixed surprises', 'Gemischte Überraschungen') },
  { value: 'creatures', label: L('Creatures only', 'Nur Tiere & Geister') },
  { value: 'spider', label: L('Spider', 'Spinne') },
  { value: 'eyes', label: L('Eyes in the dark', 'Augen im Dunkeln') },
  { value: 'ghost', label: L('Ghost peeks in', 'Geist guckt herein') },
  { value: 'cat', label: L('Black cat', 'Schwarze Katze') },
  { value: 'pumpkin', label: L('Pumpkin lights up', 'Kürbis leuchtet auf') },
  { value: 'bat', label: L('Bat', 'Fledermaus') },
  { value: 'steps', label: L('Footsteps (ground)', 'Fußspuren (Boden)') },
];

function darkScene(
  id: string,
  name: [string, string],
  description: [string, string],
  icon: string,
  events: string,
): SceneManifest {
  return scene(
    id,
    name,
    description,
    ['wall', 'floor', 'other'],
    icon,
    ['#000000', '#ffe14d'],
    [
      {
        key: 'events',
        label: L('What happens', 'Was passiert'),
        type: 'select',
        options: EVENT_OPTIONS,
        default: events,
      },
      {
        key: 'pause',
        label: L('Dark pause (s)', 'Dunkle Pause (s)'),
        type: 'number',
        min: 2,
        max: 40,
        step: 1,
        default: 8,
      },
    ],
  );
}

const scenes: SceneManifest[] = [
  scene(
    'hauntedHouse',
    ['Haunted House', 'Spukhaus'],
    [
      'Glowing windows, friendly ghosts, eyes and pumpkins.',
      'Leuchtende Fenster, freundliche Geister, Augen und Kürbisse.',
    ],
    ['wall'],
    '🏚️',
    ['#2b1a4a', '#ff8a1f'],
  ),
  scene(
    'skeletonDisco',
    ['Skeleton Disco', 'Skelett-Disco'],
    ['Dancing skeletons under soft rhythmic lights.', 'Tanzende Skelette mit sanftem rhythmischem Licht.'],
    ['wall'],
    '💀',
    ['#1a0f3a', '#d24dff'],
    [
      {
        key: 'bpm',
        label: L('Tempo (BPM)', 'Tempo (BPM)'),
        type: 'number',
        min: 70,
        max: 140,
        step: 1,
        default: 108,
      },
    ],
  ),
  scene(
    'ghostParty',
    ['Ghost Party', 'Geisterparty'],
    ['Layers of playful floating ghosts.', 'Verspielte Geister schweben in mehreren Ebenen.'],
    ['wall'],
    '👻',
    ['#10213f', '#b8e4ff'],
  ),
  scene(
    'pumpkinMagic',
    ['Pumpkin Magic', 'Kürbiszauber'],
    ['Jack-o’-lanterns with changing faces and sparks.', 'Kürbisgesichter mit wechselnder Mimik und Funken.'],
    ['wall', 'floor'],
    '🎃',
    ['#2a1405', '#ff9a2e'],
  ),
  scene(
    'monsterWindows',
    ['Monster Windows', 'Monsterfenster'],
    ['Funny monster silhouettes peek and knock.', 'Lustige Monster-Silhouetten gucken und klopfen.'],
    ['wall'],
    '🪟',
    ['#14102a', '#ffd166'],
    [
      {
        key: 'columns',
        label: L('Window columns', 'Fensterspalten'),
        type: 'number',
        min: 2,
        max: 6,
        step: 1,
        default: 4,
      },
    ],
  ),
  scene(
    'moonlitGraveyard',
    ['Moonlit Graveyard', 'Friedhof im Mondlicht'],
    ['Cute graveyard, big moon, soft rolling fog.', 'Niedlicher Friedhof, großer Mond, sanfter Nebel.'],
    ['wall'],
    '🌕',
    ['#0b1630', '#9fb7ff'],
  ),
  scene(
    'spiritPortal',
    ['Spirit Portal', 'Geisterportal'],
    [
      'A swirling shader portal with drifting spirits (WebGL).',
      'Wirbelndes Shader-Portal mit schwebenden Geistern (WebGL).',
    ],
    ['wall', 'floor'],
    '🌀',
    ['#120a2e', '#56f0c8'],
  ),
  scene(
    'spidersAndFog',
    ['Spiders & Fog', 'Spinnen & Nebel'],
    ['Friendly spiders wander through fog.', 'Freundliche Spinnen wandern durch Nebelschwaden.'],
    ['floor'],
    '🕷️',
    ['#0d1414', '#7fd1a5'],
  ),
  scene(
    'ghostFootprints',
    ['Ghost Footprints', 'Geisterspuren'],
    ['Glowing footprints appear and fade.', 'Leuchtende Fußspuren tauchen auf und verblassen.'],
    ['floor'],
    '👣',
    ['#0a1220', '#8ee6ff'],
  ),
  scene(
    'magicPath',
    ['Magic Path', 'Zauberweg'],
    [
      'Magic markers, glitter and leaves lead the way.',
      'Magische Wegmarken, Glitzer und Blätter weisen den Weg.',
    ],
    ['floor'],
    '✨',
    ['#140a24', '#ffcf5a'],
  ),
  scene(
    'pumpkinTrail',
    ['Pumpkin Trail', 'Kürbispfad'],
    ['Little bobbing pumpkins and star trails.', 'Kleine wippende Kürbisse und Sternspuren.'],
    ['floor'],
    '🛤️',
    ['#1a0d05', '#ff7b1c'],
  ),
  scene(
    'swirlingMist',
    ['Swirling Mist', 'Wirbelnder Nebel'],
    ['Colorful ground mist with sparkling highlights (shader).', 'Farbiger Bodennebel mit Glitzer (Shader).'],
    ['floor', 'wall'],
    '🌫️',
    ['#0d0a1e', '#a77bff'],
  ),
  scene(
    'tinyGhostParade',
    ['Tiny Ghost Parade', 'Mini-Geisterparade'],
    ['Small friendly ghosts glide across the ground.', 'Kleine freundliche Geister gleiten über den Boden.'],
    ['floor'],
    '🎈',
    ['#0b1426', '#e8f4ff'],
  ),
  neonScene(
    'neonManor',
    ['Neon Manor', 'Neon-Villa'],
    [
      'Bright blacklight haunted mansion with glowing sky, ghosts and pumpkins – visible at dusk.',
      'Knallbunte Spukvilla mit leuchtendem Himmel, Geistern und Kürbissen – sichtbar schon in der Dämmerung.',
    ],
    ['wall'],
    '🏰',
    ['#5b1fa8', '#ff7a1a'],
  ),
  neonScene(
    'neonParty',
    ['Neon Party', 'Neon-Party'],
    [
      'Big friendly ghosts and dancing skeletons on a bright, colorful background.',
      'Große freundliche Geister und tanzende Skelette auf hellem, buntem Hintergrund.',
    ],
    ['wall'],
    '🪩',
    ['#b84dff', '#7dff4d'],
    [
      {
        key: 'bpm',
        label: L('Tempo (BPM)', 'Tempo (BPM)'),
        type: 'number',
        min: 70,
        max: 140,
        step: 1,
        default: 108,
      },
    ],
  ),
  neonScene(
    'neonFog',
    ['Neon Fog', 'Neon-Nebel'],
    [
      'Bright swirling purple fog with glowing paw prints, leaves and black fuzzy spiders.',
      'Hell wirbelnder Lila-Nebel mit leuchtenden Pfotenspuren, Blättern und schwarzen Plüschspinnen.',
    ],
    ['floor'],
    '🌌',
    ['#8a2be2', '#7dff4d'],
  ),
  neonScene(
    'neonPumpkinPatch',
    ['Neon Pumpkin Patch', 'Neon-Kürbisfeld'],
    [
      'Bright orange-purple glow with lots of big jack-o’-lanterns and vines.',
      'Helles Orange-Lila-Leuchten mit vielen großen Kürbisgesichtern und Ranken.',
    ],
    ['floor', 'wall'],
    '🎃',
    ['#ff7a1a', '#8a2be2'],
  ),
  darkScene(
    'darkSurprises',
    ['Dark Surprises', 'Dunkel & Überraschung'],
    [
      'Almost black – your house is the set. Now and then a spider drops, eyes open, a ghost peeks in or a pumpkin lights up.',
      'Fast schwarz – dein Haus ist die Kulisse. Ab und zu seilt sich eine Spinne ab, Augen leuchten, ein Geist guckt herein oder ein Kürbis glimmt auf.',
    ],
    '🕯️',
    'mix',
  ),
  darkScene(
    'darkSpider',
    ['Lone Spider', 'Einsame Spinne'],
    [
      'Black wall, only a spider dropping on its thread in a small pool of light.',
      'Schwarze Wand, nur eine Spinne seilt sich im kleinen Lichtkegel ab.',
    ],
    '🕸️',
    'spider',
  ),
  darkScene(
    'darkEyes',
    ['Eyes in the Dark', 'Augen im Dunkeln'],
    ['Glowing eyes open, blink and vanish.', 'Leuchtende Augen öffnen sich, blinzeln und verschwinden.'],
    '👀',
    'eyes',
  ),
];

function effect(
  id: string,
  name: [string, string],
  icon: string,
  durationMs: number,
  kinds: EffectManifest['kinds'] = ['wall', 'floor', 'other'],
): EffectManifest {
  return { id, name: L(...name), icon, durationMs, cooldownMs: 1200, childSafe: true, kinds };
}

const effects: EffectManifest[] = [
  effect('boo', ['Boo!', 'Buh!'], '👻', 3200),
  effect('batSwarm', ['Bat Swarm', 'Fledermausschwarm'], '🦇', 5000),
  effect('pumpkinBurst', ['Pumpkin Burst', 'Kürbis-Explosion'], '🎃', 3500),
  effect('gentleLightning', ['Gentle Lightning', 'Sanfter Blitz'], '🌩️', 3000),
  effect('spiderRush', ['Spider Rush', 'Spinnen-Sprint'], '🕷️', 5000),
  effect('ghostWave', ['Ghost Wave', 'Geisterwelle'], '🌊', 4200),
  effect('confettiLeaves', ['Leaf Confetti', 'Blätterkonfetti'], '🍂', 5000),
  effect('sparkles', ['Sparkles', 'Funkeln'], '✨', 3500),
  effect('windowKnock', ['Window Knock', 'Fensterklopfen'], '✊', 3000, ['wall', 'other']),
  effect('skeletonDanceBreak', ['Skeleton Dance Break', 'Skelett-Tanzpause'], '🕺', 5500),
  effect('magicCircle', ['Magic Circle', 'Zauberkreis'], '🔮', 4500),
  effect('footprintChase', ['Footprint Chase', 'Fußspuren-Jagd'], '👣', 5000, ['floor', 'other', 'wall']),
];

export const halloweenManifest: ThemeManifest = {
  id: 'halloween',
  version: '1.0.0',
  name: L('Halloween', 'Halloween'),
  description: L(
    'Friendly-spooky Halloween for the whole family.',
    'Freundlich-gruseliges Halloween für die ganze Familie.',
  ),
  icon: '🎃',
  rating: 'family',
  scenes,
  effects,
  actors: [
    {
      id: 'spider',
      name: L('Spider', 'Spinne'),
      icon: '🕷️',
      kinds: ['wall', 'floor', 'other'],
      sizeM: 0.45,
      speedMps: 0.55,
      pauseSec: [0.4, 2.2],
      waypoints: [3, 6],
      childSafe: true,
    },
    {
      id: 'bat',
      name: L('Bat', 'Fledermaus'),
      icon: '🦇',
      kinds: ['wall', 'other'],
      sizeM: 0.5,
      speedMps: 1.6,
      pauseSec: [0, 0],
      waypoints: [3, 5],
      childSafe: true,
    },
    {
      id: 'ghost',
      name: L('Ghost', 'Geist'),
      icon: '👻',
      kinds: ['wall', 'other'],
      sizeM: 0.8,
      speedMps: 0.45,
      pauseSec: [0.5, 1.5],
      waypoints: [2, 4],
      childSafe: true,
    },
    {
      id: 'blackCat',
      name: L('Black Cat', 'Schwarze Katze'),
      icon: '🐈‍⬛',
      kinds: ['floor', 'other'],
      sizeM: 0.6,
      speedMps: 0.8,
      pauseSec: [0.6, 2.5],
      waypoints: [2, 4],
      childSafe: true,
    },
  ],
  presets: [
    {
      id: 'fullShow',
      name: L('Full Halloween Show', 'Komplette Halloween-Show'),
      description: L(
        'Auto-playing playlists on every surface plus roaming creatures.',
        'Automatische Playlists auf allen Flächen plus umherstreifende Kreaturen.',
      ),
      icon: '🎬',
      assignments: {
        wall: { playlistTemplateId: 'wallShow' },
        floor: { playlistTemplateId: 'floorShow' },
        other: { playlistTemplateId: 'wallShow' },
      },
      ambientActors: ['spider', 'bat', 'ghost', 'blackCat'],
    },
    {
      id: 'neonShow',
      name: L('Neon Show (dusk)', 'Neon-Show (Dämmerung)'),
      description: L(
        'Very bright, high-contrast scenes that stay visible while it is not fully dark yet.',
        'Sehr helle, kontrastreiche Szenen, die auch sichtbar sind, solange es noch nicht ganz dunkel ist.',
      ),
      icon: '🌆',
      assignments: {
        wall: { playlistTemplateId: 'neonWallShow' },
        floor: { playlistTemplateId: 'neonFloorShow' },
        other: { playlistTemplateId: 'neonWallShow' },
      },
      ambientActors: ['spider', 'bat', 'ghost'],
    },
    {
      id: 'friendlyWelcome',
      name: L('Friendly Welcome', 'Freundliches Willkommen'),
      description: L(
        'Gentle ghosts and a magic path to the door.',
        'Sanfte Geister und ein Zauberweg zur Tür.',
      ),
      icon: '🤗',
      assignments: {
        wall: { sceneId: 'ghostParty', params: { speed: 0.8 } },
        floor: { sceneId: 'magicPath' },
      },
      ambientActors: ['ghost', 'spider'],
    },
    {
      id: 'classicHaunted',
      name: L('Classic Haunted', 'Klassischer Spuk'),
      description: L('Haunted house with spiders in the fog.', 'Spukhaus mit Spinnen im Nebel.'),
      icon: '🏚️',
      assignments: { wall: { sceneId: 'hauntedHouse' }, floor: { sceneId: 'spidersAndFog' } },
      ambientActors: ['spider', 'bat'],
    },
    {
      id: 'skeletonParty',
      name: L('Skeleton Party', 'Skelett-Party'),
      description: L('Disco skeletons and a pumpkin trail.', 'Disco-Skelette und ein Kürbispfad.'),
      icon: '🪩',
      assignments: {
        wall: { sceneId: 'skeletonDisco' },
        floor: { sceneId: 'pumpkinTrail', params: { speed: 1.3 } },
      },
      ambientActors: ['bat'],
    },
    {
      id: 'magicParade',
      name: L('Magic Parade', 'Zauberparade'),
      description: L('Pumpkin magic and a tiny ghost parade.', 'Kürbiszauber und eine Mini-Geisterparade.'),
      icon: '🪄',
      assignments: { wall: { sceneId: 'pumpkinMagic' }, floor: { sceneId: 'tinyGhostParade' } },
      ambientActors: ['ghost', 'blackCat'],
    },
    {
      id: 'darkSurprise',
      name: L('Dark & Surprises', 'Dunkel & Überraschung'),
      description: L(
        'Everything dark, the house itself is the set – only small surprises appear now and then.',
        'Alles dunkel, das Haus selbst ist die Kulisse – nur ab und zu passiert etwas.',
      ),
      icon: '🕯️',
      assignments: {
        wall: { sceneId: 'darkSurprises' },
        floor: { sceneId: 'darkSurprises', params: { pause: 10 } },
        other: { sceneId: 'darkSurprises' },
      },
      ambientActors: [],
    },
    {
      id: 'quietAtmosphere',
      name: L('Quiet Atmosphere', 'Ruhige Atmosphäre'),
      description: L(
        'Moonlit graveyard and slow mist. Very calm.',
        'Friedhof im Mondlicht und langsamer Nebel. Sehr ruhig.',
      ),
      icon: '🌙',
      assignments: {
        wall: { sceneId: 'moonlitGraveyard', params: { speed: 0.6 } },
        floor: { sceneId: 'swirlingMist', params: { speed: 0.5, mood: 'blue' } },
      },
      ambientActors: [],
    },
  ],
  playlistTemplates: [
    {
      id: 'neonWallShow',
      name: L('Neon wall show (dusk)', 'Neon Wand-Show (Dämmerung)'),
      kind: 'wall',
      loop: true,
      items: [
        {
          sceneId: 'neonManor',
          durationSec: 150,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: { effectIds: ['batSwarm', 'boo', 'ghostWave'], minGapSec: 20, maxGapSec: 45 },
        },
        {
          sceneId: 'neonParty',
          durationSec: 120,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: {
            effectIds: ['skeletonDanceBreak', 'confettiLeaves', 'sparkles'],
            minGapSec: 20,
            maxGapSec: 40,
          },
        },
        {
          sceneId: 'pumpkinMagic',
          durationSec: 120,
          transition: { type: 'crossfade', durationMs: 3000 },
          params: { mood: 'neon' },
          ambient: { effectIds: ['pumpkinBurst', 'magicCircle'], minGapSec: 20, maxGapSec: 45 },
        },
        {
          sceneId: 'neonPumpkinPatch',
          durationSec: 90,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: { effectIds: ['sparkles', 'boo'], minGapSec: 20, maxGapSec: 45 },
        },
      ],
    },
    {
      id: 'neonFloorShow',
      name: L('Neon ground show (dusk)', 'Neon Boden-Show (Dämmerung)'),
      kind: 'floor',
      loop: true,
      items: [
        {
          sceneId: 'neonFog',
          durationSec: 150,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: {
            effectIds: ['spiderRush', 'footprintChase', 'confettiLeaves'],
            minGapSec: 20,
            maxGapSec: 45,
          },
        },
        {
          sceneId: 'neonPumpkinPatch',
          durationSec: 120,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: { effectIds: ['pumpkinBurst', 'sparkles'], minGapSec: 20, maxGapSec: 45 },
        },
        {
          sceneId: 'magicPath',
          durationSec: 120,
          transition: { type: 'crossfade', durationMs: 3000 },
          params: { mood: 'neon' },
          ambient: { effectIds: ['magicCircle', 'sparkles'], minGapSec: 20, maxGapSec: 45 },
        },
      ],
    },
    {
      id: 'wallShow',
      name: L('Halloween wall show', 'Halloween Wand-Show'),
      kind: 'wall',
      loop: true,
      items: [
        {
          sceneId: 'hauntedHouse',
          durationSec: 150,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: {
            effectIds: ['boo', 'batSwarm', 'windowKnock', 'gentleLightning'],
            minGapSec: 20,
            maxGapSec: 45,
          },
        },
        {
          sceneId: 'ghostParty',
          durationSec: 120,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: { effectIds: ['ghostWave', 'sparkles', 'boo'], minGapSec: 20, maxGapSec: 40 },
        },
        {
          sceneId: 'darkSurprises',
          durationSec: 90,
          transition: { type: 'crossfade', durationMs: 4000 },
        },
        {
          sceneId: 'skeletonDisco',
          durationSec: 120,
          transition: { type: 'fadeBlack', durationMs: 2500 },
          ambient: { effectIds: ['skeletonDanceBreak', 'confettiLeaves'], minGapSec: 25, maxGapSec: 50 },
        },
        {
          sceneId: 'pumpkinMagic',
          durationSec: 120,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: { effectIds: ['pumpkinBurst', 'sparkles', 'magicCircle'], minGapSec: 20, maxGapSec: 45 },
        },
        {
          sceneId: 'monsterWindows',
          durationSec: 120,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: { effectIds: ['windowKnock', 'boo'], minGapSec: 20, maxGapSec: 40 },
        },
        {
          sceneId: 'spiritPortal',
          durationSec: 90,
          transition: { type: 'crossfade', durationMs: 3500 },
          ambient: { effectIds: ['magicCircle', 'sparkles'], minGapSec: 25, maxGapSec: 50 },
        },
        {
          sceneId: 'moonlitGraveyard',
          durationSec: 150,
          transition: { type: 'crossfade', durationMs: 3500 },
          ambient: { effectIds: ['batSwarm', 'gentleLightning', 'ghostWave'], minGapSec: 25, maxGapSec: 55 },
        },
      ],
    },
    {
      id: 'floorShow',
      name: L('Halloween ground show', 'Halloween Boden-Show'),
      kind: 'floor',
      loop: true,
      items: [
        {
          sceneId: 'spidersAndFog',
          durationSec: 150,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: { effectIds: ['spiderRush', 'confettiLeaves'], minGapSec: 25, maxGapSec: 50 },
        },
        {
          sceneId: 'magicPath',
          durationSec: 120,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: { effectIds: ['sparkles', 'magicCircle'], minGapSec: 20, maxGapSec: 45 },
        },
        {
          sceneId: 'darkSurprises',
          durationSec: 90,
          transition: { type: 'crossfade', durationMs: 4000 },
        },
        {
          sceneId: 'ghostFootprints',
          durationSec: 120,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: { effectIds: ['footprintChase', 'ghostWave'], minGapSec: 20, maxGapSec: 45 },
        },
        {
          sceneId: 'pumpkinTrail',
          durationSec: 120,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: { effectIds: ['pumpkinBurst', 'confettiLeaves'], minGapSec: 20, maxGapSec: 45 },
        },
        {
          sceneId: 'tinyGhostParade',
          durationSec: 120,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: { effectIds: ['ghostWave', 'sparkles'], minGapSec: 25, maxGapSec: 50 },
        },
        {
          sceneId: 'swirlingMist',
          durationSec: 90,
          transition: { type: 'crossfade', durationMs: 3500 },
          ambient: { effectIds: ['magicCircle', 'spiderRush'], minGapSec: 25, maxGapSec: 50 },
        },
      ],
    },
    {
      id: 'quietWall',
      name: L('Quiet wall', 'Ruhige Wand'),
      kind: 'wall',
      loop: true,
      items: [
        {
          sceneId: 'moonlitGraveyard',
          durationSec: 300,
          transition: { type: 'crossfade', durationMs: 5000 },
        },
        {
          sceneId: 'ghostParty',
          durationSec: 240,
          transition: { type: 'crossfade', durationMs: 5000 },
          params: { speed: 0.6, density: 0.7 },
        },
      ],
    },
    {
      id: 'quietFloor',
      name: L('Quiet ground', 'Ruhiger Boden'),
      kind: 'floor',
      loop: true,
      items: [
        {
          sceneId: 'swirlingMist',
          durationSec: 300,
          transition: { type: 'crossfade', durationMs: 5000 },
          params: { speed: 0.5 },
        },
        {
          sceneId: 'magicPath',
          durationSec: 240,
          transition: { type: 'crossfade', durationMs: 5000 },
          params: { speed: 0.6 },
        },
      ],
    },
  ],
  defaults: { wall: 'hauntedHouse', floor: 'spidersAndFog', other: 'ghostParty' },
  starterStage: [
    { name: L('Garage', 'Garage'), kind: 'wall' },
    { name: L('Driveway', 'Einfahrt'), kind: 'floor' },
  ],
  autoPlaylists: { wall: 'wallShow', floor: 'floorShow', other: 'wallShow' },
};
