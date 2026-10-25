import { useEffect, useRef, useState } from 'react';
import { activeProfile, roomFold, wallsOfPose, type Presence, type SessionState } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';
import { ZombiePreview } from './ZombiePreview.tsx';
import { GhostGallery } from './GhostGallery.tsx';

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

/**
 * Zombie camera: this phone films the guests; the projector PCs of the front wall turn them into
 * funny zombie ghosts that drift along the wall – as long as the camera runs. The video goes
 * straight from the phone to the projector PCs (WebRTC), nothing is stored.
 */
export function ZombieCam({ state, presence, L }: { state: SessionState; presence: Presence; L: Tr }) {
  const store = useStore();
  const [on, setOn] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  // ghost photos: taken by this phone while its preview runs, else by the first projector PC;
  // saved in the show
  const [save, setSaveState] = useState(true);
  const saveRef = useRef(save);
  saveRef.current = save;
  const previewOnRef = useRef(false);
  const tellCapture = () => {
    const first = [...(run.current?.peers.keys() ?? [])][0];
    if (first)
      store.conn.sendRtc(first, { kind: 'style', capture: saveRef.current && !previewOnRef.current });
  };
  const setSave = (v: boolean) => {
    setSaveState(v);
    saveRef.current = v;
    tellCapture();
  };
  const [err, setErr] = useState<string | null>(null);
  // tap a face → ghost photo right away (the preview here, or the projector PC taking photos)
  const snapRef = useRef<((u?: number) => boolean) | null>(null);
  const [tapped, setTapped] = useState(0);
  useEffect(() => {
    if (!tapped) return;
    const t = window.setTimeout(() => setTapped(0), 2500);
    return () => window.clearTimeout(t);
  }, [tapped]);
  const snap = (u?: number) => {
    if (!saveRef.current) return;
    if (previewOnRef.current) snapRef.current?.(u);
    else {
      const first = targets(stateRef.current, presenceRef.current).find((id) => run.current?.peers.has(id));
      if (!first) return;
      store.conn.sendRtc(first, { kind: 'style', snap: u ?? 0.5 });
    }
    setTapped(Date.now());
  };
  const onVideoTap = (e: React.MouseEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    const r = v.getBoundingClientRect();
    // where the picture sits inside the element (object-fit: contain)
    const k = Math.min(r.width / Math.max(1, v.videoWidth), r.height / Math.max(1, v.videoHeight));
    const w = v.videoWidth * k;
    const x = (e.clientX - r.left - (r.width - w) / 2) / Math.max(1, w);
    // the effect mirrors the picture
    snap(Math.max(0, Math.min(1, 1 - x)));
  };
  const [links, setLinks] = useState<Record<string, string>>({});
  // test without a projector: run the effect here and show it on a preview of the front wall
  const [preview, setPreview] = useState<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const run = useRef<{ stream: MediaStream; peers: Map<string, RTCPeerConnection>; off: () => void } | null>(
    null,
  );
  const ids = targets(state, presence);
  const stateRef = useRef(state);
  stateRef.current = state;
  const presenceRef = useRef(presence);
  presenceRef.current = presence;
  const idsKey = ids.join(',');

  const stop = () => {
    const r = run.current;
    run.current = null;
    if (!r) return;
    for (const [id, pc] of r.peers) {
      store.conn.sendRtc(id, { kind: 'bye' });
      pc.close();
    }
    r.off();
    r.stream.getTracks().forEach((t) => t.stop());
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
      store.conn.sendRtc(id, {
        kind: 'offer',
        sdp: offer.sdp ?? '',
        // only one projector PC takes the photos – and none while this phone's preview does
        capture:
          saveRef.current &&
          !previewOnRef.current &&
          id === targets(stateRef.current, presenceRef.current)[0],
      });
    })();
  };

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 960 },
          height: { ideal: 720 },
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
      if (videoRef.current) videoRef.current.srcObject = stream;
      setOn(true);
    } catch (e) {
      setErr(
        L(
          `Camera not available (${(e as Error).name}). Allow camera access for this page.`,
          `Kamera nicht verfügbar (${(e as Error).name}). Kamera-Zugriff für diese Seite erlauben.`,
        ),
      );
    }
  };

  // (re)connect to projector PCs that come online while the camera runs
  useEffect(() => {
    if (!on) return;
    for (const id of ids) connect(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, idsKey]);
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const live = Object.values(links).filter((s) => s === 'connected').length;
  const previewOn = on && (preview ?? !ids.length);
  if (previewOnRef.current !== previewOn) {
    previewOnRef.current = previewOn;
    queueMicrotask(tellCapture);
  }
  return (
    <section className="panel stack">
      <div className="section-title">
        <h2>🧟 {L('Zombie camera', 'Zombie-Kamera')}</h2>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {L(
          'This phone films the guests – on the front wall they drift along as ghosts, every one with its own random look (zombie make-up, glowing eyes, scars, cartoon googly eyes …), as long as the camera runs. The video goes straight to the projector PC; only ghost photos (below) are saved.',
          'Dieses Handy filmt die Gäste – an der vorderen Wand schweben sie als Geister herum, jeder mit eigenem Zufalls-Look (Zombie-Make-up, leuchtende Augen, Narben, Comic-Glubschaugen …), solange die Kamera läuft. Das Video geht direkt zum Beamer-PC; gespeichert werden nur Geister-Fotos (unten).',
        )}
      </p>
      <video
        ref={videoRef}
        onClick={onVideoTap}
        autoPlay
        muted
        playsInline
        style={{
          display: on ? 'block' : 'none',
          width: '100%',
          maxHeight: 220,
          objectFit: 'contain',
          borderRadius: 12,
          background: '#000',
          cursor: 'crosshair',
        }}
      />
      {on && (
        <span className="small muted">
          {tapped
            ? save
              ? L('📸 Ghost photo taken!', '📸 Geister-Foto ausgelöst!')
              : L('Switch on ghost photos below first.', 'Erst unten Geister-Fotos einschalten.')
            : L(
                'Tap a face to take a ghost photo right away.',
                'Tipp auf ein Gesicht – sofort ein Geister-Foto.',
              )}
        </span>
      )}
      {previewOn && (
        <ZombiePreview
          state={state}
          now={() => store.conn.clock.now()}
          video={videoRef.current}
          capture={save}
          snapRef={snapRef}
          L={L}
        />
      )}
      {on && (
        <label
          className="small"
          style={{ display: 'flex', flexDirection: 'row', gap: '0.5rem', alignItems: 'center' }}
        >
          <input
            type="checkbox"
            checked={preview ?? !ids.length}
            onChange={(e) => setPreview(e.target.checked)}
          />
          {L(
            'Preview here on the phone (test without projector)',
            'Vorschau hier auf dem Handy (Test ohne Beamer)',
          )}
        </label>
      )}
      <div className="row">
        {!on ? (
          <>
            <button className="btn primary" onClick={() => void start()}>
              📷 {L('Start zombie camera', 'Zombie-Kamera starten')}
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
      <span className="small muted">
        {!ids.length
          ? L(
              'No projector PC is online right now – the camera can run anyway; as soon as a projector PC is online (open /display there), it gets the picture automatically.',
              'Gerade ist kein Beamer-PC online – die Kamera kann trotzdem laufen; sobald ein Beamer-PC online ist (dort /display öffnen), bekommt er das Bild automatisch.',
            )
          : on
            ? L(
                `${live} of ${ids.length} projector PCs receive the picture`,
                `${live} von ${ids.length} Beamer-PCs empfangen das Bild`,
              )
            : L(
                `Goes to ${ids.length} projector PC(s) of the front wall.`,
                `Geht an ${ids.length} Beamer-PC(s) der vorderen Wand.`,
              )}
      </span>
      <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
        {state.devices
          .filter((d) => d.status === 'approved')
          .map((d) => {
            const o = state.outputs.find((x) => x.id === d.outputId);
            const online = !!presence.devices[d.id]?.online;
            return (
              <li key={d.id}>
                {online ? '🟢' : '⚪'} {d.name}
                {o ? ` → ${o.name}` : ` – ${L('no projector assigned', 'keinem Beamer zugeordnet')}`}
                {!online && ` (${L('offline', 'offline')})`}
                {ids.includes(d.id) && ` · ${L('gets the camera', 'bekommt die Kamera')}`}
              </li>
            );
          })}
      </ul>
      <label
        className="small"
        style={{ display: 'flex', flexDirection: 'row', gap: '0.5rem', alignItems: 'center' }}
      >
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
        {L(
          'Take ghost photos: a well seen face detaches as a ghost and flies around – the photo is saved in this show (until you delete it). Ask your guests if that is ok.',
          'Geister-Fotos aufnehmen: ein gut erkanntes Gesicht löst sich als Geist und fliegt herum – das Foto wird in dieser Show gespeichert (bis du es löschst). Frag deine Gäste, ob das ok ist.',
        )}
      </label>
      {err && <div className="safety-note small">{err}</div>}
      <GhostGallery state={state} L={L} />
    </section>
  );
}
