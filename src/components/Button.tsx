import type { IconSvgElement } from "@hugeicons/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./Button.module.scss";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  icon?: IconSvgElement;
  iconEnd?: IconSvgElement;
  children: ReactNode;
}

export function Button({ variant = "secondary", loading = false, icon, iconEnd, disabled, children, className, ...rest }: Props) {
  const cls = [styles.button, styles[variant], className].filter(Boolean).join(" ");
  return (
    <button {...rest} type={rest.type ?? "button"} className={cls} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : icon && <Icon icon={icon} size={17} />}
      {children}
      {iconEnd && !loading && <Icon icon={iconEnd} size={17} />}
    </button>
  );
}

export function LinkButton({ href, children, download, icon }: { href: string; children: ReactNode; download?: boolean; icon?: IconSvgElement }) {
  return (
    <a href={href} download={download} className={`${styles.button} ${styles.secondary}`}>
      {icon && <Icon icon={icon} size={17} />}
      {children}
    </a>
  );
}
