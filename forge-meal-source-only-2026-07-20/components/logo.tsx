import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** Minimal barbell mark. Inherits color via currentColor. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect x="9" y="14.5" width="14" height="3" rx="1.5" fill="currentColor" />
      <rect x="6" y="10" width="3.5" height="12" rx="1.75" fill="currentColor" />
      <rect x="22.5" y="10" width="3.5" height="12" rx="1.75" fill="currentColor" />
      <rect x="2.5" y="12.5" width="3" height="7" rx="1.5" fill="currentColor" />
      <rect x="26.5" y="12.5" width="3" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function Logo({
  size = 28,
  withWordmark = true,
  className,
}: {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <LogoMark size={size} className="text-accent" />
      {withWordmark ? (
        <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
      ) : null}
    </div>
  );
}
