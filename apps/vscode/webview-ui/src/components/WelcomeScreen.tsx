import { BrandLogo } from "./BrandLogo";
import { useWelcomeHint } from "@/hooks/useWelcomeHint";

export function WelcomeScreen() {
  const hint = useWelcomeHint();

  return (
    <div className="flex flex-col items-center gap-3 px-4">
      <div className="flex items-center gap-2.5">
        <BrandLogo size={44} round float />
        <span className="text-sm font-bold tracking-[0.2em] text-foreground">KIMI CODE</span>
      </div>
      {hint.component ? (
        hint.component
      ) : (
        <div className="text-center space-y-0.5">
          <p className="text-xs font-medium text-foreground">{hint.title}</p>
          <p className="text-xs text-muted-foreground">{hint.description}</p>
        </div>
      )}
    </div>
  );
}
