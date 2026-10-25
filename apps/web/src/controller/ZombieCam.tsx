import { useEffect, useRef, useState } from 'react';
import { activeProfile, roomFold, wallsOfPose, type Presence, type SessionState } from '@spectrastage/shared';
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
  const [aiProvider, setAiProvider] = useState<AiProvider | null>(null);
  const [aiKey, setAiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [fxState, setFxState] = useState<'off' | 'loading' | 'ready' | 'failed'>('off');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
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

  const upload = async (image: string): Promise<string> => {
    const res = await fetch('/api/ghosts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${store.conn.authToken}` },
      body: JSON.stringify({ image, release: false }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  };

  /** The shutter: everybody in the picture → their own ghost, all rising together. */
  const shoot = () => {
    const fx = fxRef.current;
    if (!fx?.ready) return;
    const shots = fx.captureAll().slice(0, 12);
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
      // 1. the face filter photos fly right away
      let filterIds: string[];
      try {
        filterIds = [];
        for (const s of shots) filterIds.push(await upload(s.image));
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
          newIds.push(await upload(img));
          us.push(shots[i]!.u);
          await store.send({ t: 'ghost.delete', ghostId: filterIds[i]! });
        }
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
          onClick={shoot}
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
          disabled={fxState !== 'ready'}
          onClick={shoot}
        >
          📸{' '}
          {fxState === 'loading'
            ? L('Loading (about 15 MB, once) …', 'Lade (ca. 15 MB, einmalig) …')
            : fxState === 'failed'
              ? L('Does not run in this browser', 'Läuft in diesem Browser nicht')
              : L('Shutter – everybody in the picture', 'Auslösen – alle im Bild')}
        </button>
      )}
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
              onClick={() => {
                setAiProvider(k);
                setAiModel(k ? AI_MODELS[k] : '');
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {aiProvider && (
          <>
            <label className="small">
              {aiProvider === 'gemini' ? 'Gemini API key' : 'OpenAI API key'}
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={aiKey}
                onChange={(e) => setAiKey(e.target.value)}
                placeholder={aiProvider === 'gemini' ? 'AIza…' : 'sk-…'}
              />
            </label>
            <label className="small">
              {L('Model', 'Modell')}
              <input value={aiModel} spellCheck={false} onChange={(e) => setAiModel(e.target.value)} />
            </label>
            <span className="small muted">
              {L(
                'The key stays only in this open page – it is not saved and never goes to the SpectraStage server; after reloading, enter it again. Every person goes as their own photo from this phone to the provider (a few cents each) and comes back as a cut-out monster portrait. If the AI fails, the face filter photo is used.',
                'Der Key bleibt nur in dieser offenen Seite – er wird nicht gespeichert und geht nie an den SpectraStage-Server; nach dem Neuladen neu eingeben. Jede Person geht als eigenes Foto von diesem Handy zum Anbieter (je ein paar Cent) und kommt als freigestelltes Monster-Porträt zurück. Klappt die KI nicht, wird das Gesichtsfilter-Foto genommen.',
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
