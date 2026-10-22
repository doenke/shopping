/**
 * Hybrid Logical Clock. Timestamps are strings that sort lexicographically:
 * `<millis, 13 digits>:<counter, 4 digits>:<node>`.
 * They stay monotonic even when a device clock is wrong.
 */
export class Hlc {
  private millis = 0;
  private counter = 0;

  constructor(
    readonly node: string,
    private readonly now: () => number = Date.now,
  ) {}

  tick(): string {
    const wall = this.now();
    if (wall > this.millis) {
      this.millis = wall;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return format(this.millis, this.counter, this.node);
  }

  /** Advances the clock past a timestamp received from elsewhere. */
  receive(remote: string): void {
    const r = parseHlc(remote);
    if (!r) return;
    const wall = this.now();
    if (wall > this.millis && wall > r.millis) {
      this.millis = wall;
      this.counter = 0;
    } else if (r.millis > this.millis) {
      this.millis = r.millis;
      this.counter = r.counter + 1;
    } else if (r.millis === this.millis) {
      this.counter = Math.max(this.counter, r.counter) + 1;
    } else {
      this.counter++;
    }
  }
}

function format(millis: number, counter: number, node: string): string {
  return `${String(millis).padStart(13, '0')}:${String(counter).padStart(4, '0')}:${node}`;
}

export function parseHlc(ts: string): { millis: number; counter: number; node: string } | null {
  const m = /^(\d{13}):(\d{4,}):(.+)$/.exec(ts);
  if (!m) return null;
  return { millis: Number(m[1]), counter: Number(m[2]), node: m[3]! };
}

export const HLC_ZERO = format(0, 0, '0');

export function maxHlc(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
