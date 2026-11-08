"use client";

import type { IconSvgElement } from "@hugeicons/react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./Tabs.module.scss";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon?: IconSvgElement;
}

/** WAI-ARIA tabs: arrow keys, Home and End move between tabs; only the active tab is in the tab order. */
export function Tabs<T extends string>({ tabs, value, onChange, label, children }: { tabs: TabDef<T>[]; value: T; onChange: (id: T) => void; label: string; children: ReactNode }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div>
      <div role="tablist" aria-label={label} className={styles.list}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={t.id === value}
            aria-controls={`panel-${t.id}`}
            tabIndex={t.id === value ? 0 : -1}
            className={`${styles.tab} ${t.id === value ? styles.active : ""}`}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.icon && <Icon icon={t.icon} size={17} />}
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${value}`} aria-labelledby={`tab-${value}`} tabIndex={0} className={styles.panel}>
        {children}
      </div>
    </div>
  );
}
