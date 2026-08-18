import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The Kimi Code "eyes" badge from the web sidebar: a rounded badge whose two
 * eye slits are punched through a mask (so they show whatever is behind the
 * badge). The eyes look around and blink on a loop — the same animation the
 * web top-left icon plays. Timings are quickened versus the web's ambient
 * 16s/11s loops so the motion reads during short loading waits.
 */
export function KimiEyesLogo({ className }: { className?: string }) {
  // Mask ids live in the global SVG namespace; each instance needs its own.
  const maskId = useId();
  return (
    <svg viewBox="0 0 32 22" className={cn("kimi-eyes-logo", className)} role="img" aria-label="Kimi">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width="32" height="22" fill="#fff" />
          <g className="kimi-eyes-logo-eyes" fill="#000">
            <rect className="kimi-eyes-logo-eye" x="11.8" y="7" width="2.8" height="8" rx="1.4" />
            <rect className="kimi-eyes-logo-eye" x="17.4" y="7" width="2.8" height="8" rx="1.4" />
          </g>
        </mask>
      </defs>
      <rect x="1" y="1" width="30" height="20" rx="6" fill="#1783ff" mask={`url(#${maskId})`} />
    </svg>
  );
}
