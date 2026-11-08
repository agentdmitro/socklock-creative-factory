import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import styles from "./Field.module.scss";

interface Shared {
  label: string;
  hint?: string;
  error?: string;
  counter?: { value: number; max: number };
}

function Frame({ id, label, hint, error, counter, children }: Shared & { id: string; children: ReactNode }) {
  const over = counter ? counter.value > counter.max : false;
  return (
    <div className={styles.field}>
      <div className={styles.head}>
        <label htmlFor={id} className={styles.label}>{label}</label>
        {counter && (
          <span className={`${styles.counter} ${over ? styles.over : ""}`}>
            {counter.value}/{counter.max}
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p id={`${id}-msg`} className={styles.error} role="alert">{error}</p>
      ) : hint ? (
        <p id={`${id}-msg`} className={styles.hint}>{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({ label, hint, error, counter, ...rest }: Shared & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Frame id={id} label={label} hint={hint} error={error} counter={counter}>
      <input {...rest} id={id} className={`${styles.control} ${error ? styles.invalid : ""}`} aria-invalid={Boolean(error) || undefined} aria-describedby={error || hint ? `${id}-msg` : undefined} />
    </Frame>
  );
}

export function TextArea({ label, hint, error, counter, ...rest }: Shared & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Frame id={id} label={label} hint={hint} error={error} counter={counter}>
      <textarea {...rest} id={id} className={`${styles.control} ${styles.area} ${error ? styles.invalid : ""}`} aria-invalid={Boolean(error) || undefined} aria-describedby={error || hint ? `${id}-msg` : undefined} />
    </Frame>
  );
}

/** Numeric input with an optional unit shown beside the value (e.g. "min", "EGP"). */
export function NumberField({ label, hint, error, unit, ...rest }: Omit<Shared, "counter"> & { unit?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const id = useId();
  return (
    <Frame id={id} label={label} hint={hint} error={error}>
      <div className={styles.withUnit}>
        <input {...rest} id={id} type="number" inputMode="decimal" className={`${styles.control} ${error ? styles.invalid : ""}`} aria-invalid={Boolean(error) || undefined} aria-describedby={error || hint ? `${id}-msg` : undefined} />
        {unit && <span className={styles.unit} aria-hidden="true">{unit}</span>}
      </div>
    </Frame>
  );
}
