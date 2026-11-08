import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

/** Decorative Hugeicons wrapper: always hidden from assistive tech, so pair it with visible or aria text. */
export function Icon({ icon, size = 18, className }: { icon: IconSvgElement; size?: number; className?: string }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} className={className} aria-hidden="true" />;
}
