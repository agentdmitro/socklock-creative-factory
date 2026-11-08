import styles from "./Stepper.module.scss";

const STEPS = ["Source", "Concepts", "Review"] as const;

export function Stepper({ current, reachable, onGo }: { current: number; reachable: number; onGo: (i: number) => void }) {
  return (
    <nav aria-label="Progress" className={styles.nav}>
      <ol className={styles.list}>
        {STEPS.map((name, i) => {
          const state = i === current ? styles.current : i < current ? styles.done : "";
          return (
            <li key={name} className={styles.item}>
              <button type="button" className={`${styles.step} ${state}`} disabled={i > reachable} onClick={() => onGo(i)} aria-current={i === current ? "step" : undefined}>
                <span className={styles.dot}>{i < current ? "✓" : i + 1}</span>
                <span className={styles.name}>{name}</span>
              </button>
              {i < STEPS.length - 1 && <span className={styles.line} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
