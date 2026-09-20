import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The desktop app's animated Kimi mascot: a Rive canvas playing
 * `kimi-mascot.riv` (shipped in dist/, loaded from the extension base URI),
 * with the desktop's static fallback SVG underneath until the runtime is
 * ready. Reduced-motion users and load failures keep the static SVG. The
 * Rive module is lazy-loaded so the mascot costs nothing until first shown.
 */
type RiveModule = typeof import("@rive-app/canvas-lite");
type RiveInstance = InstanceType<RiveModule["Rive"]>;

let riveModulePromise: Promise<RiveModule> | undefined;

function loadRiveModule(): Promise<RiveModule> {
  riveModulePromise ??= import("@rive-app/canvas-lite");
  return riveModulePromise;
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function RiveMascot({ className }: { className?: string }) {
  const gradientId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    const baseUri = document.body.getAttribute("data-baseuri");
    if (!canvas || !baseUri) return;

    let cancelled = false;
    let rive: RiveInstance | undefined;
    let themeObserver: MutationObserver | undefined;

    const applyTheme = () => {
      const instance = rive;
      if (!instance) return;
      const smName = instance.stateMachineNames[0];
      if (smName === undefined) return;
      const input = (instance.stateMachineInputs(smName) ?? []).find(
        (entry) => entry.name === "light/dark",
      );
      if (input !== undefined) input.value = isDarkMode();
    };

    loadRiveModule()
      .then(({ Rive, RuntimeLoader }) => {
        if (cancelled) return;
        RuntimeLoader.setWasmUrl(`${baseUri}/dist/rive.wasm`);
        const instance = new Rive({
          canvas,
          src: `${baseUri}/dist/kimi-mascot.riv`,
          autoplay: true,
          onLoad: () => {
            if (cancelled) return;
            const smName = instance.stateMachineNames[0];
            if (smName !== undefined) instance.play(smName);
            applyTheme();
            requestAnimationFrame(() => {
              if (cancelled) return;
              instance.resizeDrawingSurfaceToCanvas();
              setReady(true);
            });
          },
        });
        rive = instance;
        themeObserver = new MutationObserver(applyTheme);
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class"],
        });
      })
      .catch(() => undefined);

    const onResize = () => rive?.resizeDrawingSurfaceToCanvas();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      themeObserver?.disconnect();
      window.removeEventListener("resize", onResize);
      rive?.cleanup();
    };
  }, []);

  return (
    <div className={cn("relative aspect-[72/100]", className)} role="img" aria-label="Kimi mascot">
      {!ready && (
        <svg
          className="absolute left-1/2 top-1/2 block w-[86.5%] h-auto -translate-x-1/2 -translate-y-1/2"
          viewBox="5 0 240.776 240.776"
          aria-hidden="true"
        >
          <defs>
            <radialGradient
              id={gradientId}
              cx="0"
              cy="0"
              r="1"
              gradientUnits="userSpaceOnUse"
              gradientTransform="translate(125.388 105.735) scale(121.866)"
            >
              <stop stopColor="#117DFB" />
              <stop stopColor="#449BFF" offset="0.759254" />
              <stop stopColor="#77B6FF" offset="1" />
            </radialGradient>
          </defs>
          <g>
            <path
              d="M125.388 0C191.877 0 245.776 53.8995 245.776 120.388C245.776 186.877 191.877 240.776 125.388 240.776C58.8996 240.776 5 186.877 5 120.388C5 53.8995 58.8996 0 125.388 0Z"
              fill="#2389FF"
            />
            <path
              d="M125.388 0C191.877 0 245.776 53.8995 245.776 120.388C245.776 186.877 191.877 240.776 125.388 240.776C58.8996 240.776 5 186.877 5 120.388C5 53.8995 58.8996 0 125.388 0Z"
              fill={`url(#${gradientId})`}
            />
          </g>
          <g transform="translate(-33.4 0)">
            <g transform="rotate(7.8 127.94 83.94)">
              <path
                d="M111.089 73.2179C109.935 64.8166 115.756 57.078 124.091 55.9333C132.426 54.7886 140.117 60.6713 141.271 69.0726L144.785 94.6564C145.939 103.058 140.118 110.796 131.783 111.941C123.449 113.086 115.757 107.203 114.603 98.8018L111.089 73.2179Z"
                fill="#FFFFFF"
              />
            </g>
            <g transform="translate(0 8.5) rotate(7.8 189.67 75.44)">
              <path
                d="M174.422 65.1492C173.326 57.1679 178.518 49.8626 186.019 48.8324C193.52 47.8021 200.489 53.4371 201.586 61.4184L204.924 85.723C206.02 93.7042 200.828 101.01 193.327 102.04C185.825 103.07 178.856 97.435 177.76 89.4538L174.422 65.1492Z"
                fill="#FFFFFF"
              />
            </g>
          </g>
        </svg>
      )}
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute inset-0 block h-full w-full transition-opacity duration-250",
          ready ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
