/**
 * Serializes all writes and delta reads. With a single server process this
 * guarantees that sequence numbers are committed in order, so a client cursor
 * can never skip a row that commits later. Plenty for a household.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
