import { activeProfile, mountOf, type Output } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';

type Mount = 'front' | 'ceiling' | 'rear' | 'ceilingRear';

/** How the projector hangs – set here instead of in the projector's own menu. */
export function MountPicker({ output, L }: { output: Output; L: Tr }) {
  const store = useStore();
  const cur = mountOf(activeProfile(output));
  const opts: [Mount, string, string][] = [
    ['front', '📽', L('Normal (table, in front)', 'Normal (Tisch, von vorne)')],
    ['ceiling', '🙃', L('Ceiling (upside down)', 'Decke (über Kopf)')],
    ['rear', '🪞', L('From behind (screen)', 'Von hinten (Leinwand)')],
    ['ceilingRear', '🙃🪞', L('Ceiling + from behind', 'Decke + von hinten')],
  ];
  return (
    <div className="stack" style={{ gap: '0.4rem' }}>
      <span className="small muted">{L('Mounting:', 'Montage:')}</span>
      <div className="row" role="group" aria-label={L('Mounting', 'Montage')}>
        {opts.map(([m, icon, label]) => (
          <button
            key={m}
            className={`chip${cur === m ? ' on' : ''}`}
            aria-pressed={cur === m}
            onClick={() => void store.send({ t: 'output.setMount', outputId: output.id, mount: m })}
          >
            {icon} {label}
          </button>
        ))}
      </div>
      {cur === 'other' && (
        <span className="small muted">
          {L(
            'Custom orientation (set in the 2D calibration).',
            'Eigene Ausrichtung (in der 2D-Kalibrierung eingestellt).',
          )}
        </span>
      )}
    </div>
  );
}
