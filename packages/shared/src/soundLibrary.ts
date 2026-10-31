/**
 * Real recordings to replace built-in sounds (all CC0 – free to use, from OpenGameArt), chosen by
 * ear in the test area. Files: apps/web/public/sounds/lib/<id>.mp3 (mono, loudness evened out,
 * at most 7 s).
 */
export interface LibrarySound {
  /** Which sound it can replace ('b:ooh' building block, 'e:theme/effect' effect). */
  slot: string;
  id: string;
  name: string;
  sec: number;
  source: string;
}

export const SOUND_LIBRARY: LibrarySound[] = [
  {
    slot: 'b:ooh',
    id: 'ghost-ghost-wav',
    name: 'Geist (Stöhnen)',
    sec: 3.29,
    source: 'https://opengameart.org/content/ghost',
  },
  {
    slot: 'b:ooh',
    id: 'ghostly-humming-ghostly-humming-ogg',
    name: 'Geister-Summen',
    sec: 7.03,
    source: 'https://opengameart.org/content/ghostly-humming',
  },
  {
    slot: 'b:ooh',
    id: 'misc-sfx-pack-ghostohh',
    name: 'Geister-Ohh',
    sec: 1.88,
    source: 'https://opengameart.org/content/misc-sfx-pack',
  },
  {
    slot: 'b:ooh',
    id: 'undead-moans-undead-1-ogg',
    name: 'Untoter stöhnt',
    sec: 2.32,
    source: 'https://opengameart.org/content/undead-moans',
  },
  {
    slot: 'b:chime',
    id: 'pleasing-bell-sound-effect-pleasing-bell-ogg',
    name: 'Glocke',
    sec: 0.65,
    source: 'https://opengameart.org/content/pleasing-bell-sound-effect',
  },
  {
    slot: 'b:chime',
    id: 'bell-dingschimes-bell-ding2-wav',
    name: 'Glöckchen',
    sec: 1.49,
    source: 'https://opengameart.org/content/bell-dingschimes',
  },
  {
    slot: 'b:chime',
    id: 'doorbell-ring-doorbell-old-tring',
    name: 'Alte Türglocke',
    sec: 4.39,
    source: 'https://opengameart.org/content/doorbell-ring',
  },
  {
    slot: 'b:pop',
    id: 'pop-pop-ogg',
    name: 'Plopp',
    sec: 0.1,
    source: 'https://opengameart.org/content/pop',
  },
  {
    slot: 'b:pop',
    id: 'bubbles-pop-pop-ogg',
    name: 'Blase platzt',
    sec: 0.31,
    source: 'https://opengameart.org/content/bubbles-pop',
  },
  {
    slot: 'b:pop',
    id: 'pop-effect-sounds-p-1-ogg',
    name: 'Kurzer Plopp',
    sec: 0.13,
    source: 'https://opengameart.org/content/pop-effect-sounds',
  },
  {
    slot: 'b:arpeggio',
    id: 'mystery-sting-mystery-sting-ogg',
    name: 'Geheimnisvoller Akkord',
    sec: 5.72,
    source: 'https://opengameart.org/content/mystery-sting',
  },
  {
    slot: 'b:arpeggio',
    id: 'childrens-xylophone-xylophone-1-ogg',
    name: 'Kinder-Xylophon',
    sec: 1.2,
    source: 'https://opengameart.org/content/childrens-xylophone',
  },
  {
    slot: 'b:arpeggio',
    id: 'bell-arpeggio-24-24-0-mp3',
    name: 'Glocken-Melodie',
    sec: 2.59,
    source: 'https://opengameart.org/content/bell-arpeggio-24',
  },
  {
    slot: 'e:halloween/boo',
    id: 'horror-scream1-scream-horror1-mp3',
    name: 'Horror-Schrei',
    sec: 7.03,
    source: 'https://opengameart.org/content/horror-scream1',
  },
  {
    slot: 'e:halloween/boo',
    id: 'scary-high-pitched-ghost-scaryhighpitchedghost-ogg',
    name: 'Hoher Geisterschrei',
    sec: 7.03,
    source: 'https://opengameart.org/content/scary-high-pitched-ghost',
  },
  {
    slot: 'e:halloween/boo',
    id: 'oh-you-scared-me-oh-you-scared-me-ogg',
    name: '„Oh, du hast mich erschreckt“',
    sec: 5.8,
    source: 'https://opengameart.org/content/oh-you-scared-me',
  },
  {
    slot: 'e:halloween/boo',
    id: 'i-see-you-voice-i-see-you-voice-mp3',
    name: '„I see you“-Stimme',
    sec: 6.97,
    source: 'https://opengameart.org/content/i-see-you-voice',
  },
  {
    slot: 'e:halloween/pumpkinBurst',
    id: 'break-pumpkin-pumpkin-break-01-ogg',
    name: 'Kürbis zerbricht 1',
    sec: 0.42,
    source: 'https://opengameart.org/content/break-pumpkin',
  },
  {
    slot: 'e:halloween/pumpkinBurst',
    id: 'break-pumpkin-pumpkin-break-02-ogg',
    name: 'Kürbis zerbricht 2',
    sec: 0.39,
    source: 'https://opengameart.org/content/break-pumpkin',
  },
  {
    slot: 'e:halloween/pumpkinBurst',
    id: 'squish-sounds-effects-squish-01-0-mp3',
    name: 'Matsch',
    sec: 0.5,
    source: 'https://opengameart.org/content/squish-sounds-effects',
  },
  {
    slot: 'e:halloween/ghostWave',
    id: 'wind-whoosh-loop-wind-20woosh-20loop-ogg',
    name: 'Wind-Rauschen',
    sec: 6.01,
    source: 'https://opengameart.org/content/wind-whoosh-loop',
  },
  {
    slot: 'e:halloween/ghostWave',
    id: 'ghost-breath-montageaudio',
    name: 'Geisterhauch',
    sec: 3.68,
    source: 'https://opengameart.org/content/ghost-breath',
  },
  {
    slot: 'e:halloween/ghostWave',
    id: 'undead-moans-undead-2-ogg',
    name: 'Untote Welle',
    sec: 1.91,
    source: 'https://opengameart.org/content/undead-moans',
  },
  {
    slot: 'e:halloween/sparkles',
    id: 'magic-spell-sfx-magical-1-ogg',
    name: 'Magie 1',
    sec: 1.65,
    source: 'https://opengameart.org/content/magic-spell-sfx',
  },
  {
    slot: 'e:halloween/sparkles',
    id: 'magic-spell-sfx-magical-2-ogg',
    name: 'Magie 2',
    sec: 1.41,
    source: 'https://opengameart.org/content/magic-spell-sfx',
  },
  {
    slot: 'e:halloween/sparkles',
    id: 'theremin-sci-fi-sparkles-theremin-sparkle-sampler-mp3',
    name: 'Theremin-Funkeln',
    sec: 7.03,
    source: 'https://opengameart.org/content/theremin-sci-fi-sparkles',
  },
  {
    slot: 'e:halloween/skeletonDanceBreak',
    id: 'bones-2-bones-2-ogg',
    name: 'Knochen klappern',
    sec: 1.18,
    source: 'https://opengameart.org/content/bones-2',
  },
  {
    slot: 'e:halloween/skeletonDanceBreak',
    id: 'skeletonsfxshortpack-skeleton1sfx-0-wav',
    name: 'Skelett',
    sec: 3.74,
    source: 'https://opengameart.org/content/skeletonsfxshortpack',
  },
  {
    slot: 'e:halloween/skeletonDanceBreak',
    id: 'childrens-xylophone-xylophone-2-ogg',
    name: 'Xylophon (Knochen)',
    sec: 2.25,
    source: 'https://opengameart.org/content/childrens-xylophone',
  },
  {
    slot: 'e:halloween/magicCircle',
    id: 'magic-spell-sfx-magical-3-ogg',
    name: 'Zauber 3',
    sec: 1.85,
    source: 'https://opengameart.org/content/magic-spell-sfx',
  },
  {
    slot: 'e:halloween/magicCircle',
    id: 'teleport-spell-teleport-wav',
    name: 'Teleport-Zauber',
    sec: 1.67,
    source: 'https://opengameart.org/content/teleport-spell',
  },
  {
    slot: 'e:halloween/magicCircle',
    id: 'freeze-spell-0-freeze-wav',
    name: 'Frost-Zauber',
    sec: 2.17,
    source: 'https://opengameart.org/content/freeze-spell-0',
  },
  {
    slot: 'e:basic/pulse',
    id: 'heartbeat-sounds-heartbeat-slow-0-wav',
    name: 'Herzschlag langsam',
    sec: 1.83,
    source: 'https://opengameart.org/content/heartbeat-sounds',
  },
  {
    slot: 'e:basic/pulse',
    id: 'heartbeat-single-sound-heartbeat-mp3-flac-mp3',
    name: 'Herzschlag',
    sec: 4.52,
    source: 'https://opengameart.org/content/heartbeat-single-sound',
  },
  {
    slot: 'e:basic/shootingStars',
    id: 'air-whoosh-whoosh2-0-wav',
    name: 'Luft-Wusch',
    sec: 5.28,
    source: 'https://opengameart.org/content/air-whoosh',
  },
  {
    slot: 'e:basic/shootingStars',
    id: 'magic-spell-sfx-magical-4-ogg',
    name: 'Magie 4',
    sec: 2.46,
    source: 'https://opengameart.org/content/magic-spell-sfx',
  },
  {
    slot: 'e:basic/shootingStars',
    id: 'swish-bamboo-stick-weapon-swhoshes-montageaudio',
    name: 'Zisch',
    sec: 7.03,
    source: 'https://opengameart.org/content/swish-bamboo-stick-weapon-swhoshes',
  },
];

/**
 * Built-in sounds that are silent until something else is chosen (marked as annoying – synthetic
 * tones that do not fit a real Halloween night).
 */
export const SOUNDS_OFF_BY_DEFAULT = [
  'b:ooh',
  'b:chime',
  'b:pop',
  'b:arpeggio',
  'e:halloween/boo',
  'e:halloween/pumpkinBurst',
  'e:halloween/ghostWave',
  'e:halloween/sparkles',
  'e:halloween/skeletonDanceBreak',
  'e:halloween/magicCircle',
  'e:basic/pulse',
  'e:basic/shootingStars',
];

/**
 * What plays for a sound: the built-in one (null), silence ('off') or a recording (URL). A choice
 * is 'orig' | 'off' | 'lib:<id>' | 'up:<id>' (uploaded by the user).
 */
export function soundChoicesOf(
  choices: Record<string, string> | undefined,
): Record<string, { url: string } | 'off'> {
  const out: Record<string, { url: string } | 'off'> = {};
  for (const slot of SOUNDS_OFF_BY_DEFAULT) out[slot] = 'off';
  for (const [slot, c] of Object.entries(choices ?? {})) {
    if (c === 'orig') delete out[slot];
    else if (c === 'off') out[slot] = 'off';
    else if (c.startsWith('lib:')) out[slot] = { url: soundUrl(c) };
    else if (c.startsWith('up:')) out[slot] = { url: soundUrl(c) };
  }
  return out;
}

/** The address of a recording choice ('lib:<id>' → bundled file, 'up:<id>' → uploaded). */
export function soundUrl(choice: string): string {
  if (choice.startsWith('lib:')) return `/sounds/lib/${encodeURIComponent(choice.slice(4))}.mp3`;
  return `/api/sounds/${encodeURIComponent(choice.slice(3))}`;
}
