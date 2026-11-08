/**
 * Small in-memory guards. This is a single-user local tool, so limits are global rather than per client:
 * their job is to stop a runaway page, a loop or a stray LAN request from burning AI spend or all CPU cores.
 */

export function rateLimit(name: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(name) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(name, hits);
    return false;
  }
  hits.push(now);
  buckets.set(name, hits);
  return true;
}
const buckets = new Map<string, number[]>();

/** At most `size` tasks run at once; the rest wait their turn (FIFO). */
export class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly size: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.size) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
