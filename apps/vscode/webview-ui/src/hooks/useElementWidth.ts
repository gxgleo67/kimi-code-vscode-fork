import { useLayoutEffect, useRef, useState } from "react";

/**
 * Observes an element's content-box width via ResizeObserver.
 *
 * The initial width is Infinity so the first render takes the "roomy" branch
 * (full labels); useLayoutEffect then measures and corrects synchronously
 * before paint, so callers never flash a collapsed layout on mount.
 */
export function useElementWidth<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>;
  width: number;
} {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number>(Number.POSITIVE_INFINITY);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => setWidth(el.clientWidth);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
