import type { ReactNode } from "react";
import styles from "./Badge.module.scss";

export type BadgeTone = "neutral" | "ok" | "danger" | "warn" | "forecast";

/** Small status pill. Colour is never the only signal: the text always says what it means. */
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
