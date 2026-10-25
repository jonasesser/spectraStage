/**
 * Ghost photos made by an image AI (Google Gemini or OpenAI), straight from the phone: the photo
 * of the guest goes with the user's own API key to the provider, the monster portrait comes back,
 * gets cut out (MediaPipe selfie segmentation) and is uploaded to the show like any ghost photo.
 * The key lives only in this page's memory – never stored, never sent to our server.
 */
import type * as Mp from '@mediapipe/tasks-vision';
import type { Kind, Look } from '../display/faceFilter.ts';

export type AiProvider = 'gemini' | 'openai';
export const AI_MODELS: Record<AiProvider, string> = {
  gemini: 'gemini-nano-banana-2.1',
  openai: 'gpt-image-2.5-flare',
};

/** Several takes per creature – one is picked at random for every person. */
const CREATURE: Record<Kind, string[]> = {
  zombie: [
    'a freshly risen zombie: grey-green skin, sunken dark eye sockets, scratches and dried blood',
    'a long-dead rotting zombie: peeling grey skin, exposed cheekbone, dark veins, cracked lips',
    'a Frankenstein-like patched-together undead: stitched seams across the face, greenish skin, neck bolts',
    'a funny cartoonish B-movie zombie with a goofy grin, green skin and messy stitches',
  ],
  ghost: [
    'a translucent pale-blue glowing ghost with hollow black eyes and a wailing mouth, wisps of mist',
    'a Victorian ghost: ghostly white skin, faintly glowing, dark empty eyes, period clothing, trailing mist',
    'a drowned ghost: wet hair, pale blue-green skin, dark rings around the eyes, dripping water',
  ],
  vampire: [
    'an elegant vampire count: pale skin, glowing red eyes, sharp fangs, high-collared cape',
    'a vampire bride: porcelain skin, dark smoky eyes, blood-red lips, fangs, gothic lace',
    'a feral Nosferatu-style vampire: bald pale head, pointed ears, long fangs, sunken eyes',
  ],
  skeleton: [
    'a living skeleton with Día de los Muertos skull make-up, colourful flowers and patterns',
    'a creepy realistic skull face: bone-white skin, black eye sockets, bare teeth painted across the lips',
    'a glowing skeleton: X-ray-like bones shining through translucent skin',
  ],
  devil: [
    'a devil: red skin, curved black horns, glowing yellow eyes, sharp eyebrows, small goatee',
    'a dark demon: charcoal-black cracked skin with glowing lava-orange cracks, big horns, fiery eyes',
    'a mischievous little devil: rosy red skin, small horns, a cheeky grin, pointed ears',
  ],
  werewolf: [
    'a werewolf in mid-transformation: fur on the face, wolf ears, yellow eyes, fangs',
    'a fully transformed grey werewolf with a wolf snout, keeping the person’s eyes and expression',
  ],
  witch: [
    'a wicked witch: green skin, a tall crooked black witch hat, warts, purple lips',
    'a beautiful dark witch: pale skin, dark purple lipstick, glowing violet eyes, a black pointed hat',
    'an old swamp hag: wrinkled grey-green skin, crooked nose, wild hair, a battered hat',
  ],
  comic: [
    'a funny cartoon zombie with big googly eyes, in a colourful comic style',
    'a cute Pixar-style little monster version of the person with big eyes',
  ],
};
const EXTRA: Partial<Record<Look['marks'][number], string>> = {
  knife: 'a kitchen knife stuck in the top of the head',
  arrow: 'an arrow shot straight through the head',
  bolts: 'metal bolts in the neck',
  bandage: 'a bloody plaster on the forehead',
  cheek: 'a deep cut on one cheek',
  forehead: 'stitches across the forehead',
};
const EYES: Record<Look['eyes'], string> = {
  yellow: 'glowing yellow eyes',
  red: 'glowing red eyes',
  milky: 'milky white blind eyes',
  black: 'pitch-black eyes',
  blue: 'icy glowing blue eyes',
};
const MOOD = [
  'cold moonlight from above',
  'eerie green light from below',
  'flickering candle light',
  'thin fog around the figure',
  'a faint ghostly glow around the outline',
];

export function aiPrompt(look: Look): string {
  let x = (look.seed * 2654435761) >>> 0 || 1;
  const r = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const extras = look.kind === 'zombie' ? look.marks.map((m) => EXTRA[m]).filter(Boolean) : ([] as string[]);
  const eyes =
    look.kind === 'ghost' || look.kind === 'skeleton' || look.kind === 'comic' ? '' : EYES[look.eyes];
  const details = [eyes, ...extras].filter(Boolean).join(', ');
  return (
    `Turn the person in this photo into ${pick(CREATURE[look.kind])}` +
    (details ? `, with ${details}` : '') +
    ', for a Halloween projection show. ' +
    'The person must stay clearly recognisable: same face, features, expression, hairstyle and clothes. ' +
    'Movie-quality special-effects make-up and prosthetics, photorealistic, ' +
    `dramatic spooky lighting with ${pick(MOOD)}. ` +
    'Show only this one person, head and upper body, centred, the whole head (and any hat or horns) in the picture with room above it, ' +
    'on a plain pure black background. No text, no frame.'
  );
}

const b64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);
const mimeOf = (dataUrl: string) => dataUrl.slice(5, dataUrl.indexOf(';'));

/** Finds the first base64 image anywhere in a provider response. */
function findImage(o: unknown): { data: string; mime: string } | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  for (const k of ['b64_json', 'data']) {
    const v = r[k];
    if (typeof v === 'string' && v.length > 1000) {
      const mime = (r.mime_type ?? r.mimeType ?? 'image/png') as string;
      return { data: v, mime: typeof mime === 'string' ? mime : 'image/png' };
    }
  }
  for (const v of Object.values(r)) {
    const f = Array.isArray(v) ? v.map(findImage).find(Boolean) : findImage(v);
    if (f) return f;
  }
  return null;
}

async function errorText(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    return j.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function callGemini(key: string, model: string, photo: string, prompt: string): Promise<string> {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      model,
      input: [
        { type: 'text', text: prompt },
        { type: 'image', mime_type: mimeOf(photo), data: b64(photo) },
      ],
      response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: '3:4' },
    }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  const img = findImage(await res.json());
  if (!img) throw new Error('no image in the answer');
  return `data:${img.mime};base64,${img.data}`;
}

async function callOpenAi(key: string, model: string, photo: string, prompt: string): Promise<string> {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('image', await (await fetch(photo)).blob(), 'photo.png');
  form.append('size', '1024x1536');
  form.append('quality', 'medium');
  form.append('output_format', 'png');
  form.append('background', 'transparent');
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(await errorText(res));
  const img = findImage(await res.json());
  if (!img) throw new Error('no image in the answer');
  return `data:image/png;base64,${img.data}`;
}

let segmenter: Promise<Mp.ImageSegmenter> | null = null;
function getSegmenter(): Promise<Mp.ImageSegmenter> {
  segmenter ??= (async () => {
    const vision = await import('@mediapipe/tasks-vision');
    const files = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
    return vision.ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: '/mediapipe/selfie_segmenter.tflite' },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  })();
  return segmenter;
}

/** Cuts the figure out of the AI picture (transparent background), at most 560 px high. */
async function cutOut(dataUrl: string): Promise<string> {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const k = Math.min(1, 560 / bmp.height);
  const W = Math.round(bmp.width * k);
  const H = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, W, H);
  bmp.close();
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  // already transparent (OpenAI)? then keep it
  let clear = 0;
  for (let p = 3; p < d.length; p += 40) if (d[p]! < 20) clear++;
  if (clear < d.length / 40 / 20) {
    try {
      const seg = await getSegmenter();
      const r = seg.segment(c);
      const m = r.confidenceMasks?.[0]?.getAsFloat32Array();
      // a dark background (as asked): glowing parts outside the figure (mist, eyes) may stay
      let edge = 0;
      let en = 0;
      for (let x = 0; x < W; x += 4)
        for (const y of [0, H - 1]) {
          const p = (y * W + x) * 4;
          edge += Math.max(d[p]!, d[p + 1]!, d[p + 2]!) / 255;
          en++;
        }
      const dark = edge / Math.max(1, en) < 0.15;
      if (m)
        for (let i = 0, p = 0; i < W * H; i++, p += 4) {
          const a = m[i]!;
          // the black background goes, the glowing parts (mist, eyes) stay
          const lum = Math.max(d[p]!, d[p + 1]!, d[p + 2]!) / 255;
          const fig = a <= 0.3 ? 0 : (a - 0.3) / 0.3;
          d[p + 3] = 255 * Math.min(1, dark ? Math.max(fig, Math.max(0, lum - 0.12) * 1.2) : fig);
        }
      r.close();
    } catch {
      // no segmentation: the black background simply turns transparent
      for (let p = 0; p < d.length; p += 4)
        d[p + 3] = 255 * Math.min(1, (Math.max(d[p]!, d[p + 1]!, d[p + 2]!) / 255) * 3);
    }
    g.putImageData(img, 0, 0);
  }
  let url = c.toDataURL('image/webp', 0.88);
  if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
  return url;
}

/** The AI version of a ghost photo (cut out, ready to upload). */
export async function aiGhost(
  provider: AiProvider,
  key: string,
  model: string,
  photo: string,
  look: Look,
): Promise<string> {
  const prompt = aiPrompt(look);
  const out =
    provider === 'gemini'
      ? await callGemini(key, model || AI_MODELS.gemini, photo, prompt)
      : await callOpenAi(key, model || AI_MODELS.openai, photo, prompt);
  return cutOut(out);
}
