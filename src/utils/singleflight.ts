import metrics from "../middleware/metrics";

interface PendingCall<T> {
  promise: Promise<T>;
  count: number;
}

/**
 * Singleflight promise coalescing (#48).
 *
 * Ensures that concurrent callers with the same key share a single in-flight
 * promise. The first caller executes the function; subsequent callers for the
 * same key await the existing promise. Once the promise settles, the key is
 * removed so future callers re-execute.
 */
export class Singleflight {
  private readonly pending = new Map<string, PendingCall<unknown>>();

  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) {
      existing.count++;
      metrics.recordSingleflightCoalesced();
      metrics.recordSingleflightPending(this.pending.size);
      return existing.promise as Promise<T>;
    }

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.pending.delete(key);
        metrics.recordSingleflightPending(this.pending.size);
      }
    })();

    this.pending.set(key, { promise, count: 1 });
    metrics.recordSingleflightPending(this.pending.size);
    return promise;
  }

  getPendingCount(): number {
    return this.pending.size;
  }

  hasPending(key: string): boolean {
    return this.pending.has(key);
  }
}

export const singleflight = new Singleflight();
