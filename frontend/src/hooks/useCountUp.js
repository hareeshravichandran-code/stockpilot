import { useEffect, useRef, useState } from 'react';

/** Animates a number from its previous value to `target` (ease-out). Returns the current value. */
export default function useCountUp(target, ms = 900) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const to = Number(target) || 0;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setV(to); from.current = to; return undefined; }
    const start = performance.now(); const a = from.current;
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / ms); const e = 1 - Math.pow(1 - k, 3);
      setV(a + (to - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
