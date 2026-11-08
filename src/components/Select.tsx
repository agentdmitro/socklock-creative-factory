"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./Icon";
import styles from "./Select.module.scss";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface Props<T extends string> {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Show the label above the control instead of hiding it visually (it is always available to screen readers). */
  showLabel?: boolean;
  className?: string;
}

/**
 * Custom single-select following the WAI-ARIA select-only combobox pattern:
 * Enter/Space/Arrow open, Arrows/Home/End move, typing jumps to a match, Enter selects, Escape/Tab close.
 * The list opens upward when there is not enough room below (e.g. inside the sticky action bar).
 */
export function Select<T extends string>({ label, value, options, onChange, disabled, showLabel, className }: Props<T>) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false);
  const typed = useRef({ text: "", at: 0 });
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const show = () => {
    if (disabled) return;
    const rect = root.current?.getBoundingClientRect();
    const needed = Math.min(options.length * 52 + 16, 280);
    setUp(Boolean(rect) && window.innerHeight - (rect?.bottom ?? 0) < needed && (rect?.top ?? 0) > needed);
    setActive(selectedIndex);
    setOpen(true);
  };

  const choose = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    const last = options.length - 1;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setActive((i) => Math.min(last, i + 1)); break;
      case "ArrowUp": e.preventDefault(); setActive((i) => Math.max(0, i - 1)); break;
      case "Home": e.preventDefault(); setActive(0); break;
      case "End": e.preventDefault(); setActive(last); break;
      case "Enter": case " ": e.preventDefault(); choose(active); break;
      case "Escape": e.preventDefault(); setOpen(false); break;
      case "Tab": setOpen(false); break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          const now = Date.now();
          typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
          const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
          if (hit >= 0) setActive(hit);
        }
    }
  };

  return (
    <div className={`${styles.root} ${className ?? ""}`} ref={root}>
      <span id={`${id}-label`} className={showLabel ? styles.label : "sr-only"}>{label}</span>
      <button
        type="button"
        role="combobox"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        onBlur={(e) => !root.current?.contains(e.relatedTarget as Node) && setOpen(false)}
      >
        <span id={`${id}-value`} className={styles.value}>{current?.label}</span>
        <Icon icon={ArrowDown01Icon} size={16} className={`${styles.chevron} ${open ? styles.flip : ""}`} />
      </button>
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className={`${styles.list} ${up ? styles.up : ""}`}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`${styles.option} ${i === active ? styles.active : ""}`}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              <span className={styles.optionText}>
                <span>{o.label}</span>
                {o.hint && <span className={styles.optionHint}>{o.hint}</span>}
              </span>
              {o.value === value && <Icon icon={Tick02Icon} size={16} className={styles.tick} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
