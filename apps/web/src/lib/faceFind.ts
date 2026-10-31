import type { FaceBox } from '@spectrastage/engine';
import type * as Mp from '@mediapipe/tasks-vision';

/**
 * Finds the face in a guest's photo (MediaPipe face landmarks, self-hosted model) – for putting
 * it onto a figure's face. One finder for the page, loaded on first use; null when no face (or
 * the finder can't load).
 */
let finder: Promise<Mp.FaceLandmarker | null> | null = null;

function load(): Promise<Mp.FaceLandmarker | null> {
  finder ??= (async () => {
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const files = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const make = (delegate: 'GPU' | 'CPU') =>
        vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate },
          runningMode: 'IMAGE',
          numFaces: 1,
          minFaceDetectionConfidence: 0.4,
          minFacePresenceConfidence: 0.4,
        });
      // CPU first: it is used rarely and must not take GPU memory from the show
      return await make('CPU').catch(() => make('GPU'));
    } catch {
      return null;
    }
  })();
  return finder;
}

// one at a time
let queue: Promise<unknown> = Promise.resolve();

export function findFace(img: HTMLCanvasElement): Promise<FaceBox | null> {
  const run = queue.then(async () => {
    const f = await load();
    if (!f) return null;
    try {
      const pts = f.detect(img).faceLandmarks[0];
      if (!pts || pts.length < 300) return null;
      return boxOf(pts, img.width / img.height);
    } catch {
      return null;
    }
  });
  queue = run.catch(() => null);
  return run;
}

/** Face box from the 468 landmarks: upright (rolled back by the eye line). */
export function boxOf(pts: readonly { x: number; y: number }[], aspect: number): FaceBox {
  // eyes: outer corners 33 (image left) and 263 (image right)
  const a = pts[33]!;
  const b = pts[263]!;
  const roll = Math.atan2((b.y - a.y) / aspect, b.x - a.x);
  const c = Math.cos(-roll);
  const s = Math.sin(-roll);
  // into an upright frame (x in picture widths, y in picture widths too, so angles hold)
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    const x = p.x;
    const y = p.y / aspect;
    const u = x * c - y * s;
    const v = x * s + y * c;
    x0 = Math.min(x0, u);
    x1 = Math.max(x1, u);
    y0 = Math.min(y0, v);
    y1 = Math.max(y1, v);
  }
  const cu = (x0 + x1) / 2;
  const cv = (y0 + y1) / 2;
  // back into the picture
  const cx = cu * Math.cos(roll) - cv * Math.sin(roll);
  const cy = (cu * Math.sin(roll) + cv * Math.cos(roll)) * aspect;
  return { cx, cy, w: x1 - x0, h: (y1 - y0) * aspect, roll };
}
