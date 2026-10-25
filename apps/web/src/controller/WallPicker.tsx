import { useState } from 'react';
import {
  activeProfile,
  poseForWalls,
  roomFold,
  ROOM_WALLS,
  ROOM_WALL_LABEL,
  wallsOfPose,
  type Output,
  type RoomWall,
  type SessionState,
} from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';

const EN: Record<RoomWall, string> = {
  vorne: 'Front',
  rechts: 'Right',
  hinten: 'Back',
  links: 'Left',
  boden: 'Floor',
  decke: 'Ceiling',
};

/** Which sides of the room this projector lights – tap to choose; it is set up to cover them. */
export function WallPicker({ output, state, L }: { output: Output; state: SessionState; L: Tr }) {
  const store = useStore();
  const [hint, setHint] = useState<string | null>(null);
  const prof = activeProfile(output);
  const ref = prof.referenceResolution;
  const aspect = ref ? ref.w / ref.h : 16 / 9;
  // projectors set up before sides were chosen: show what they light now
  const walls = prof.walls ?? (prof.pose ? wallsOfPose(roomFold(state.surfaces), prof.pose, aspect) : []);
  const toggle = (w: RoomWall) => {
    const next = walls.includes(w) ? walls.filter((x) => x !== w) : [...walls, w];
    const auto = next.length ? poseForWalls(roomFold(state.surfaces), next, aspect) : null;
    // allowed anyway – without an automatic position the projector stays and is measured in
    setHint(
      next.length && !auto
        ? L(
            `No automatic position found for ${next.map((x) => EN[x]).join(' + ')} – the projector keeps its position; measure it in.`,
            `Für ${next.map((x) => ROOM_WALL_LABEL[x]).join(' + ')} finde ich keine automatische Position – der Beamer bleibt, wo er ist. Einfach einmessen.`,
          )
        : null,
    );
    if (
      auto &&
      activeProfile(output).anchors?.length &&
      !window.confirm(
        L(
          'The projector will be set up anew and its measured points removed. Continue?',
          'Der Beamer wird neu aufgestellt, seine gemessenen Punkte werden entfernt. Weiter?',
        ),
      )
    )
      return;
    void store.send({ t: 'output.setWalls', outputId: output.id, walls: next });
  };
  return (
    <div className="stack" style={{ gap: '0.4rem' }}>
      <span className="small muted">
        {L('Lights these sides of the room:', 'Bestrahlt diese Seiten des Raums:')}
      </span>
      <div className="row" role="group" aria-label={L('Sides of the room', 'Seiten des Raums')}>
        {ROOM_WALLS.map((w) => (
          <button
            key={w}
            className={`chip${walls.includes(w) ? ' on' : ''}`}
            aria-pressed={walls.includes(w)}
            onClick={() => toggle(w)}
          >
            {L(EN[w], ROOM_WALL_LABEL[w])}
          </button>
        ))}
      </div>
      {hint && <div className="safety-note small">{hint}</div>}
    </div>
  );
}
