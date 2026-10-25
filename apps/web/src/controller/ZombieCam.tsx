import { useEffect, useRef, useState } from 'react';
import { activeProfile, roomFold, wallsOfPose, type Presence, type SessionState } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';

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
  const [style, setStyleState] = useState<'makeup' | 'comic'>('makeup');
  const styleRef = useRef(style);
  styleRef.current = style;
  const setStyle = (st: 'makeup' | 'comic') => {
    setStyleState(st);
    for (const id of run.current?.peers.keys() ?? []) store.conn.sendRtc(id, { kind: 'style', style: st });
  };
  const [err, setErr] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const run = useRef<{ stream: MediaStream; peers: Map<string, RTCPeerConnection>; off: () => void } | null>(
    null,
  );
  const ids = targets(state, presence);
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
      store.conn.sendRtc(id, { kind: 'offer', sdp: offer.sdp ?? '', style: styleRef.current });
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
  return (
    <section className="panel stack">
      <div className="section-title">
        <h2>🧟 {L('Zombie camera', 'Zombie-Kamera')}</h2>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {L(
          'This phone films the guests – on the front wall they drift along as funny zombie ghosts, as long as the camera runs. Nothing is stored; the video goes straight to the projector PC.',
          'Dieses Handy filmt die Gäste – an der vorderen Wand schweben sie als lustige Zombie-Geister herum, solange die Kamera läuft. Nichts wird gespeichert; das Video geht direkt zum Beamer-PC.',
        )}
      </p>
      <video
        ref={videoRef}
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
        }}
      />
      <div className="row" role="group" aria-label={L('Look', 'Aussehen')}>
        {(
          [
            ['makeup', '🧟 ' + L('Zombie make-up (recognisable)', 'Zombie-Make-up (erkennbar)')],
            ['comic', '👀 ' + L('Comic with googly eyes', 'Comic mit Glubschaugen')],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`chip${style === k ? ' on' : ''}`} onClick={() => setStyle(k)}>
            {label}
          </button>
        ))}
      </div>
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
      {err && <div className="safety-note small">{err}</div>}
    </section>
  );
}
