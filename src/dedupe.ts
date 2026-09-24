/**
 * Remembers which message ids have already been handled, so a redelivered
 * webhook does not produce a second reply.
 *
 * Messenger and Zalo both retry a delivery when the acknowledgement is slow or
 * lost, and a retry carries the same message id. Without this guard a customer
 * receives the same answer twice, and any side effect of the handler, such as
 * creating an order, happens twice.
 *
 * Entries expire after `ttlMs`, which bounds memory for a long-running process.
 * `maxEntries` is a second bound for a burst large enough to outpace expiry:
 * the oldest entries are dropped first. Both are enforced, so the store cannot
 * grow without limit.
 *
 * This implementation keeps state in memory, which is correct for a single
 * process. Run more than one instance and each keeps its own view, so a retry
 * routed to another instance is not recognised as a duplicate. Back it with
 * Redis (`SET key 1 NX PX ttl`) when you scale out.
 */
export class DedupeStore {
  readonly #seen = new Map<string, number>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    this.#ttlMs = options.ttlMs ?? 10 * 60 * 1000;
    this.#maxEntries = options.maxEntries ?? 10_000;
  }

  /**
   * Records `key` and reports whether it is new.
   *
   * Returns true the first time a key is seen and false for every repeat while
   * the entry is still alive. Checking and recording happen in one call so two
   * concurrent deliveries of the same id cannot both be treated as new.
   */
  admit(key: string, now: number = Date.now()): boolean {
    const expiresAt = this.#seen.get(key);

    if (expiresAt !== undefined && expiresAt > now) return false;

    // Either unseen or expired. Delete first so the re-insert moves the key to
    // the end of the Map's insertion order, which is what #evict() relies on.
    this.#seen.delete(key);
    this.#seen.set(key, now + this.#ttlMs);
    this.#prune(now);
    return true;
  }

  /** Number of entries currently held, expired ones included. */
  get size(): number {
    return this.#seen.size;
  }

  /** Drops every entry. Intended for tests and for a clean restart. */
  clear(): void {
    this.#seen.clear();
  }

  #prune(now: number): void {
    if (this.#seen.size <= this.#maxEntries) return;

    for (const [key, expiresAt] of this.#seen) {
      if (expiresAt <= now) this.#seen.delete(key);
    }

    // Expired entries alone may not be enough under a burst of live ones.
    // Map iterates in insertion order, so this drops the oldest first.
    for (const key of this.#seen.keys()) {
      if (this.#seen.size <= this.#maxEntries) break;
      this.#seen.delete(key);
    }
  }
}
