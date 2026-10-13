import { useEffect, useState } from 'react';
import { COARSE_QUERY } from '../utils/scroll-mode.js';

const read = () => { try { return typeof window !== 'undefined' && window.matchMedia(COARSE_QUERY).matches; } catch { return false; } };

/** true on touch-first devices (iPhone, Android, iPad without a mouse). Read synchronously on the client (ScriptOutput only mounts there), then kept live. */
export function useCoarsePointer() {
  const [coarse, setCoarse] = useState(read);
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia(COARSE_QUERY); } catch { return undefined; }
    const on = () => setCoarse(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return coarse;
}
