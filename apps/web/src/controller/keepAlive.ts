import { useEffect, useRef } from 'react';

/**
 * Setup states on the projector (measuring picture, object / facade outlines) only live for a
 * short time on the server and are renewed by the open screen. Closing or reloading the page
 * (F5) without leaving properly then can't leave them stuck on the projector – they expire.
 */
export const KEEP_ALIVE_MS = 15_000;

export function useKeepAlive(send: () => void, active: boolean): void {
  const ref = useRef(send);
  ref.current = send;
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => ref.current(), KEEP_ALIVE_MS);
    return () => window.clearInterval(t);
  }, [active]);
}
