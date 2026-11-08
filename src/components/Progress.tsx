import styles from "./Progress.module.scss";

/** value omitted → indeterminate. */
export function Progress({ value, label }: { value?: number; label: string }) {
  const determinate = typeof value === "number";
  return (
    <div className={styles.wrap}>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? Math.round(value) : undefined}
      >
        <div className={`${styles.bar} ${determinate ? "" : styles.indeterminate}`} style={determinate ? { width: `${value}%` } : undefined} />
      </div>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
