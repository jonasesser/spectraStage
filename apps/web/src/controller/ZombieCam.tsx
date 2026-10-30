import { useEffect, useRef, useState } from 'react';
import {
  activeProfile,
  roomFold,
  surfacesForSides,
  wallsOfPose,
  type Presence,
  type SessionState,
} from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';
import { GhostGallery } from './GhostGallery.tsx';
import { AI_MODELS, aiGhost, type AiProvider } from '../lib/aiGhost.ts';
import { ZombieFx } from '../display/zombie.ts';

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

/** Projector PCs that should show the zombies: those lighting the front wall (else all online). */
function targets(state: SessionState, presence: Presence): string[] {
  const fold = roomFold(state.surfaces);
  const online = state.devices.filter(
    (d) => d.status === 'approved' && d.outputId && presence.devices[d.id]?.online,
  );
  const front = online.filter((d) => {
    const o = state.outputs.find((x) => x.id === d.outputId);
    if (!o) return false;
    const p = activeProfile(o);
    const walls = p.walls ?? (p.pose ? wallsOfPose(fold, p.pose) : []);
    return walls.includes('vorne') || !p.pose;
  });
  return (front.length ? front : online).map((d) => d.id);
}

interface Job {
  id: number;
  n: number;
  done: number;
  state: 'working' | 'flying' | 'failed';
  /** The AI portraits that replace the filter photos. */
  ai?: 'painting' | 'done' | 'failed';
  note?: string;
}

/**
 * Ghost photo shooting: this phone films the guests; one press of the shutter takes a ghost photo
 * of everybody in the picture (a group of five → five ghosts). With an image AI every person is
 * painted as a monster portrait in parallel in the background; when all are ready they are saved
 * in the show and rise together on the projectors. Optional: the live picture of the camera on the
 * projectors (off by default).
 */
export function ZombieCam({ state, presence, L }: { state: SessionState; presence: Presence; L: Tr }) {
  const store = useStore();
  const [on, setOn] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  const [err, setErr] = useState<string | null>(null);
  // the live camera picture on the projectors (off by default)
  const [live, setLive] = useState(false);
  // monster portraits by an image AI with the user's own key (in memory only)
  // both keys can be entered at once; the buttons switch which AI paints
  const [aiProvider, setAiProvider] = useState<AiProvider | null>(null);
  const [aiKeys, setAiKeys] = useState<Record<AiProvider, string>>({ gemini: '', openai: '' });
  const [aiModels, setAiModels] = useState<Record<AiProvider, string>>({ ...AI_MODELS });
  const aiKey = aiProvider ? aiKeys[aiProvider] : '';
  const aiModel = aiProvider ? aiModels[aiProvider] : '';
  const [fxState, setFxState] = useState<'off' | 'loading' | 'ready' | 'failed'>('off');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  // light for the picture (in the dark): the projectors become a photo lamp, the phone's lamp
  const [beamLight, setBeamLight] = useState(true);
  const [torch, setTorch] = useState(true);
  const [busy, setBusy] = useState(false);
  const jobId = useRef(1);
  const fxRef = useRef<ZombieFx | null>(null);
  const stopLoop = useRef<(() => void) | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const run = useRef<{ stream: MediaStream; peers: Map<string, RTCPeerConnection>; off: () => void } | null>(
    null,
  );
  const [links, setLinks] = useState<Record<string, string>>({});
  const ids = targets(state, presence);
  const idsKey = ids.join(',');

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 3000);
    return () => window.clearTimeout(t);
  }, [flash]);

  const patchJob = (id: number, p: Partial<Job> | ((j: Job) => Partial<Job>)) =>
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...(typeof p === 'function' ? p(j) : p) } : j)));

  const upload = async (
    image: string,
    kind: 'original' | 'filter' | 'ai',
    group: string,
  ): Promise<string> => {
    const res = await fetch('/api/ghosts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${store.conn.authToken}` },
      body: JSON.stringify({ image, release: false, kind, group }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  };

  /** The phone's lamp on / off (where the browser can – Android; not on iPhone). */
  const setLamp = async (onOff: boolean): Promise<boolean> => {
    const track = run.current?.stream.getVideoTracks()[0];
    if (!track) return false;
    const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
    if (!caps.torch) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: onOff } as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  };

  /**
   * The shutter: light first (projectors bright, phone lamp) – the camera needs a moment to see
   * in it and the person recognition a fresh picture – then the picture: everybody in it → their
   * own ghost, all rising together.
   */
  const shoot = async () => {
    const fx = fxRef.current;
    if (!fx?.ready || busy) return;
    const lit = beamLight || torch;
    if (lit) {
      setBusy(true);
      setFlash(L('💡 Light …', '💡 Licht …'));
      const front = surfacesForSides(state.surfaces, ['main', 'floorFront']);
      if (beamLight && front.length)
        void store.send({
          t: 'effect.fire',
          surfaceIds: front.map((x) => x.id),
          themeId: 'halloween',
          effectId: 'photoLight',
        });
      const lamp = torch ? await setLamp(true) : false;
      // the projectors start ~0.2 s later; then exposure and a recognised picture in that light
      await new Promise((res) => setTimeout(res, beamLight ? 1100 : 800));
      try {
        snap(fx);
      } finally {
        if (lamp) void setLamp(false);
        setBusy(false);
      }
      return;
    }
    snap(fx);
  };

  const snap = (fx: ZombieFx) => handleShots(fx.captureAll().slice(0, 12));

  // a photo instead of the live camera (works on every phone, also iPhone: the phone's own
  // camera with its flash, or a picture from the gallery)
  const stillFx = useRef<ZombieFx | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onPhoto = async (f: File) => {
    setBusy(true);
    setFlash(L('Looking for people in the photo …', 'Suche Personen im Foto …'));
    try {
      let fx = fxRef.current?.ready ? fxRef.current : stillFx.current;
      if (!fx) {
        setFlash(L('Loading (about 15 MB, once) …', 'Lade (ca. 15 MB, einmalig) …'));
        fx = new ZombieFx();
        await fx.init();
        stillFx.current = fx;
      }
      if (!fx.ready) throw new Error(L('does not run in this browser', 'läuft in diesem Browser nicht'));
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.src = url;
      await img.decode();
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(8, Math.round(img.naturalWidth * k));
      c.height = Math.max(8, Math.round(img.naturalHeight * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      handleShots((await fx.processStill(c)).slice(0, 12));
    } catch (e) {
      setFlash(
        L(`Photo could not be used (${(e as Error).message})`, `Foto ging nicht (${(e as Error).message})`),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleShots = (shots: ReturnType<ZombieFx['captureAll']>) => {
    if (!shots.length) {
      setFlash(L('Nobody recognised – faces towards the camera.', 'Niemand erkannt – Gesichter zur Kamera.'));
      return;
    }
    const id = jobId.current++;
    const ai =
      aiProvider && aiKey.trim() ? { provider: aiProvider, key: aiKey.trim(), model: aiModel.trim() } : null;
    setJobs((js) => [{ id, n: shots.length, done: 0, state: 'working' as const }, ...js].slice(0, 6));
    setFlash(
      shots.length > 1
        ? L(`📸 ${shots.length} people taken`, `📸 ${shots.length} Personen aufgenommen`)
        : L('📸 Taken', '📸 Aufgenommen'),
    );
    void (async () => {
      // every guest keeps all pictures: the plain one (for faces on figures), the face filter
      // one and (if wanted) the AI one – grouped
      const groups = shots.map(() => Math.random().toString(36).slice(2, 12));
      // 1. the face filter photos fly right away
      let filterIds: string[];
      try {
        filterIds = [];
        for (let i = 0; i < shots.length; i++)
          filterIds.push(await upload(shots[i]!.image, 'filter', groups[i]!));
        // the plain photos (never fly) – one that does not get through must not stop the ghosts
        for (let i = 0; i < shots.length; i++)
          await upload(shots[i]!.original, 'original', groups[i]!).catch((e: Error) =>
            console.warn('[SpectraStage] original photo', e.message),
          );
        // all of them at once, each from where the person stood
        await store.send({ t: 'ghost.release', ghostIds: filterIds, u: shots.map((s) => s.u) });
        patchJob(id, { state: 'flying', ai: ai ? 'painting' : undefined });
      } catch (e) {
        patchJob(id, { state: 'failed', note: (e as Error).message });
        return;
      }
      if (!ai) return;
      // 2. one AI painter per person, all at the same time; when all are back, the AI portraits
      // replace the filter photos and rise together
      let aiFailed = '';
      const painted = await Promise.all(
        shots.map(async (s) => {
          try {
            return await aiGhost(ai.provider, ai.key, ai.model, s.photo, s.look);
          } catch (e) {
            aiFailed = (e as Error).message;
            return null;
          } finally {
            patchJob(id, (j) => ({ done: j.done + 1 }));
          }
        }),
      );
      try {
        const newIds: string[] = [];
        const us: number[] = [];
        for (let i = 0; i < shots.length; i++) {
          const img = painted[i];
          if (!img) continue;
          newIds.push(await upload(img, 'ai', groups[i]!));
          us.push(shots[i]!.u);
        }
        // the AI pictures take over from the filter ones (which stay in the gallery)
        if (newIds.length) await store.send({ t: 'ghost.stopFlights', ghostIds: filterIds });
        if (newIds.length) await store.send({ t: 'ghost.release', ghostIds: newIds, u: us });
        patchJob(id, {
          ai: aiFailed ? 'failed' : 'done',
          note: aiFailed
            ? L(
                `AI failed for ${shots.length - newIds.length} (${aiFailed}) – the filter photo stays.`,
                `KI fehlgeschlagen bei ${shots.length - newIds.length} (${aiFailed}) – das Filter-Foto bleibt.`,
              )
            : undefined,
        });
      } catch (e) {
        patchJob(id, { ai: 'failed', note: (e as Error).message });
      }
    })();
  };

  const disconnect = (id: string) => {
    const r = run.current;
    const pc = r?.peers.get(id);
    if (!r || !pc) return;
    store.conn.sendRtc(id, { kind: 'bye' });
    pc.close();
    r.peers.delete(id);
    setLinks((l) => {
      const n = { ...l };
      delete n[id];
      return n;
    });
  };

  const stop = () => {
    const r = run.current;
    if (r) for (const id of [...r.peers.keys()]) disconnect(id);
    run.current = null;
    r?.off();
    r?.stream.getTracks().forEach((t) => t.stop());
    stopLoop.current?.();
    stopLoop.current = null;
    fxRef.current?.dispose();
    fxRef.current = null;
    setFxState('off');
    setLinks({});
  };

  const connect = (id: string) => {
    const r = run.current;
    if (!r || r.peers.has(id)) return;
    const pc = new RTCPeerConnection(ICE);
    r.peers.set(id, pc);
    for (const t of r.stream.getVideoTracks()) pc.addTrack(t, r.stream);
    pc.onicecandidate = (e) =>
      store.conn.sendRtc(id, { kind: 'ice', candidate: e.candidate?.toJSON() as never });
    pc.onconnectionstatechange = () => {
      setLinks((l) => ({ ...l, [id]: pc.connectionState }));
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        r.peers.delete(id);
        pc.close();
      }
    };
    void (async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      store.conn.sendRtc(id, { kind: 'offer', sdp: offer.sdp ?? '' });
    })();
  };

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1280 },
          height: { ideal: 960 },
          frameRate: { ideal: 24 },
        },
        audio: false,
      });
      const peers = new Map<string, RTCPeerConnection>();
      const off = store.conn.onRtc((from, data) => {
        const id = from.split(':')[1] ?? '';
        const pc = peers.get(id);
        if (!pc) return;
        if (data.kind === 'answer' && data.sdp)
          void pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        else if (data.kind === 'ice' && data.candidate)
          void pc.addIceCandidate(data.candidate).catch(() => {});
        else if (data.kind === 'bye') {
          peers.delete(id);
          pc.close();
        }
      });
      run.current = { stream, peers, off };
      const video = videoRef.current;
      if (video) video.srcObject = stream;
      setOn(true);
      // the effect runs here on the phone (it finds the people and makes the photos)
      const fx = new ZombieFx();
      fx.preview = previewRef.current;
      fxRef.current = fx;
      setFxState('loading');
      await fx.init();
      if (fxRef.current !== fx) return;
      setFxState(fx.ready ? 'ready' : 'failed');
      // keep the people list fresh too (nobody shows these sprites here)
      stopLoop.current = fx.loop(video!, 90, () => fx.sprites(0.09, true));
    } catch (e) {
      setErr(
        L(
          `Camera not available (${(e as Error).name}). Allow camera access for this page.`,
          `Kamera nicht verfügbar (${(e as Error).name}). Kamera-Zugriff für diese Seite erlauben.`,
        ),
      );
    }
  };

  // the live picture on the projectors: connect / disconnect
  useEffect(() => {
    if (!on) return;
    const r = run.current;
    if (!r) return;
    if (live) for (const id of ids) connect(id);
    else for (const id of [...r.peers.keys()]) disconnect(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, idsKey, live]);
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const connected = Object.values(links).filter((s) => s === 'connected').length;
  const working = jobs.filter((j) => j.state === 'working' || j.ai === 'painting').length;
  return (
    <section className="panel stack">
      <div className="section-title">
        <h2>👻 {L('Ghost photos', 'Geister-Fotos')}</h2>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {L(
          'Point the camera at your guests and press the shutter: everybody in the picture becomes their own ghost (a random creature – zombie, ghost, vampire, skeleton, devil, werewolf, witch …), saved in this show and rising on the projectors. Ask your guests if that is ok.',
          'Kamera auf die Gäste richten und auslösen: Jede Person im Bild wird zu ihrem eigenen Geist (zufällige Gestalt – Zombie, Geist, Vampir, Skelett, Teufel, Werwolf, Hexe …), wird in dieser Show gespeichert und steigt auf den Beamern auf. Frag deine Gäste, ob das ok ist.',
        )}
      </p>
      <div style={{ position: 'relative', display: on ? 'block' : 'none' }}>
        {/* the camera itself stays invisible underneath – shown is the result, live */}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
        <canvas
          ref={previewRef}
          onClick={() => void shoot()}
          style={{
            position: 'relative',
            display: 'block',
            width: '100%',
            maxHeight: 420,
            objectFit: 'contain',
            borderRadius: 12,
            background: '#0d0b1a',
            cursor: 'pointer',
          }}
        />
      </div>
      {on && (
        <button
          className="btn primary"
          style={{ fontSize: '1.15rem', padding: '0.9rem' }}
          disabled={fxState !== 'ready' || busy}
          onClick={() => void shoot()}
        >
          📸{' '}
          {fxState === 'loading'
            ? L('Loading (about 15 MB, once) …', 'Lade (ca. 15 MB, einmalig) …')
            : fxState === 'failed'
              ? L('Does not run in this browser', 'Läuft in diesem Browser nicht')
              : L('Shutter – everybody in the picture', 'Auslösen – alle im Bild')}
        </button>
      )}
      {on && (
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={beamLight} onChange={(e) => setBeamLight(e.target.checked)} />
            {L('Projectors light up for the photo', 'Beamer leuchten beim Foto hell auf')}
          </label>
          <label className="check">
            <input type="checkbox" checked={torch} onChange={(e) => setTorch(e.target.checked)} />
            {L("Phone's lamp (Android)", 'Handy-Lampe (Android)')}
          </label>
        </div>
      )}
      <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
        🖼{' '}
        {L(
          'Take or choose a photo (phone camera with flash)',
          'Foto aufnehmen oder wählen (Handy-Kamera mit Blitz)',
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void onPhoto(f);
        }}
      />
      {flash && <strong className="small">{flash}</strong>}
      {jobs.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {jobs.map((j) => (
            <li key={j.id}>
              {j.n === 1 ? L('1 person', '1 Person') : L(`${j.n} people`, `${j.n} Personen`)}:{' '}
              {j.state === 'working'
                ? L('saving …', 'speichere …')
                : j.state === 'failed'
                  ? L('✗ failed', '✗ fehlgeschlagen')
                  : j.ai === 'painting'
                    ? L(`✓ flying · AI painting … ${j.done}/${j.n}`, `✓ fliegt · KI malt … ${j.done}/${j.n}`)
                    : j.ai === 'done'
                      ? L('✓ AI portraits flying', '✓ KI-Porträts fliegen')
                      : L('✓ flying', '✓ fliegt')}
              {j.note && <span className="muted"> – {j.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {working > 0 && (
        <span className="small muted">
          {L(
            'You can keep shooting – the AI works in the background.',
            'Du kannst weiter auslösen – die KI arbeitet im Hintergrund.',
          )}
        </span>
      )}
      <div className="row">
        {!on ? (
          <>
            <button className="btn primary" onClick={() => void start()}>
              📷 {L('Start camera', 'Kamera starten')}
            </button>
            <button
              className="btn small"
              onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
            >
              {facing === 'user' ? L('Front camera', 'Frontkamera') : L('Back camera', 'Rückkamera')} 🔄
            </button>
          </>
        ) : (
          <button
            className="btn danger"
            onClick={() => {
              stop();
              setOn(false);
            }}
          >
            ⏹ {L('Stop camera', 'Kamera stoppen')}
          </button>
        )}
      </div>

      <div className="stack" style={{ gap: '0.4rem' }}>
        <span className="small">{L('Photo look', 'Foto-Stil')}</span>
        <div className="row" role="group">
          {(
            [
              [null, L('Face filter', 'Gesichtsfilter')],
              ['gemini', '✨ KI · Gemini'],
              ['openai', '✨ KI · OpenAI'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k ?? 'filter'}
              className={`chip${aiProvider === k ? ' on' : ''}`}
              onClick={() => setAiProvider(k)}
            >
              {label}
              {k && !aiKeys[k].trim() ? L(' · no key', ' · kein Key') : ''}
            </button>
          ))}
        </div>
        {aiProvider && (
          <>
            {(
              [
                ['gemini', 'Gemini API key', 'AIza…'],
                ['openai', 'OpenAI API key', 'sk-…'],
              ] as const
            ).map(([k, label, ph]) => (
              <label key={k} className="small">
                {label}
                {aiProvider === k ? L(' (in use)', ' (aktiv)') : ''}
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input
                    className="grow"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={aiKeys[k]}
                    onChange={(e) => setAiKeys((x) => ({ ...x, [k]: e.target.value }))}
                    placeholder={ph}
                  />
                  <button
                    type="button"
                    className="btn icon small"
                    disabled={!aiKeys[k]}
                    aria-label={L('Delete key', 'Key löschen')}
                    title={L('Delete key', 'Key löschen')}
                    onClick={() => setAiKeys((x) => ({ ...x, [k]: '' }))}
                  >
                    ✕
                  </button>
                </div>
              </label>
            ))}
            <label className="small">
              {L('Model', 'Modell')} ({aiProvider === 'gemini' ? 'Gemini' : 'OpenAI'})
              <input
                value={aiModel}
                spellCheck={false}
                onChange={(e) => setAiModels((x) => ({ ...x, [aiProvider]: e.target.value }))}
              />
            </label>
            {!aiKey.trim() && (
              <span className="small" style={{ color: 'var(--lantern)' }}>
                {L(
                  'No key for this AI – the face filter photo is used.',
                  'Kein Key für diese KI – es wird das Gesichtsfilter-Foto genommen.',
                )}
              </span>
            )}
            <span className="small muted">
              {L(
                'Both keys can be entered; the buttons above switch which AI paints. The keys stay only in this open page – they are not saved and never goes to the SpectraStage server; after reloading, enter it again. Every person goes as their own photo from this phone to the provider (a few cents each) and comes back as a cut-out monster portrait. If the AI fails, the face filter photo is used.',
                'Beide Keys können eingetragen sein, die Knöpfe oben wechseln die KI. Die Keys bleiben nur in dieser offenen Seite – sie werden nicht gespeichert und geht nie an den SpectraStage-Server; nach dem Neuladen neu eingeben. Jede Person geht als eigenes Foto von diesem Handy zum Anbieter (je ein paar Cent) und kommt als freigestelltes Monster-Porträt zurück. Klappt die KI nicht, wird das Gesichtsfilter-Foto genommen.',
              )}
            </span>
          </>
        )}
      </div>

      <label
        className="small"
        style={{ display: 'flex', flexDirection: 'row', gap: '0.5rem', alignItems: 'center' }}
      >
        <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
        {L(
          'Also show the live camera picture on the projectors (guests as live ghosts with face filter)',
          'Zusätzlich das Live-Kamerabild auf den Beamern zeigen (Gäste als Live-Geister mit Gesichtsfilter)',
        )}
      </label>
      {live && (
        <span className="small muted">
          {!ids.length
            ? L('No projector PC online right now.', 'Gerade ist kein Beamer-PC online.')
            : L(
                `${connected} of ${ids.length} projector PCs receive the live picture`,
                `${connected} von ${ids.length} Beamer-PCs empfangen das Live-Bild`,
              )}
        </span>
      )}
      {err && <div className="safety-note small">{err}</div>}
      <GhostGallery state={state} L={L} />
    </section>
  );
}
