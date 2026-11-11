import type { PlaceData } from '@shopping/shared';

/** Thrown when there is no place search (PHOTON_URL not set) or Photon does not answer. */
export class PlacesUnavailable extends Error {}
/** The one who asked is gone (typed on, closed the form): nobody waits for the answer any more. */
export class PlacesCancelled extends PlacesUnavailable {}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Name and address of a Photon hit: "Hornbach" · "Bahnhofstr. 3, 22767 Hamburg". */
export function placeFromPhoton(f: PhotonFeature): PlaceData | null {
  const [lon, lat] = f.geometry?.coordinates ?? [];
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const p = f.properties ?? {};
  const street = [str(p.street), str(p.housenumber)].filter(Boolean).join(' ') || null;
  const town = [str(p.postcode), str(p.city) ?? str(p.town) ?? str(p.village) ?? str(p.district)].filter(Boolean).join(' ') || null;
  const name = str(p.name) ?? street ?? town ?? str(p.country) ?? '';
  // Named after its street ("Bahnhofstraße 3"): the address need not say it again.
  const address = [street === name ? null : street, town === name ? null : town].filter(Boolean).join(', ') || null;
  return { name, address, lat, lon };
}

/**
 * Place search and "what is here" through the household's own Photon server (PHOTON_URL), so the app
 * needs no access to it and no third party learns where anybody is.
 *
 * Photon may run on a small, busy machine: only one question goes to it at a time, the others wait in
 * line. A question whose asker is gone (signal aborted) leaves the line, or – already running – is
 * called off, which also stops Photon's search.
 */
export class PlaceService {
  constructor(
    private readonly baseUrl: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 30_000,
  ) {}

  /** The end of the line: resolves when the last question queued so far is done. */
  private line: Promise<void> = Promise.resolve();

  get available(): boolean {
    return !!this.baseUrl;
  }

  /** Runs `job` once every question before it is done – unless `signal` is aborted while it waits. */
  private async inLine<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const before = this.line;
    let done!: () => void;
    this.line = new Promise<void>((r) => (done = r));
    try {
      await before;
      if (signal?.aborted) throw new PlacesCancelled('Die Suche wurde abgebrochen');
      return await job();
    } finally {
      done();
    }
  }

  private get(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<PhotonFeature[]> {
    return this.inLine(() => this.ask(path, params, signal), signal);
  }

  private async ask(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<PhotonFeature[]> {
    if (!this.baseUrl) throw new PlacesUnavailable('Ortssuche ist nicht eingerichtet (PHOTON_URL)');
    const url = new URL(path, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    let res: Response;
    const timeout = AbortSignal.timeout(this.timeoutMs);
    try {
      res = await this.fetchImpl(url, { signal: signal ? AbortSignal.any([timeout, signal]) : timeout, headers: { accept: 'application/json' } });
    } catch (err) {
      if (signal?.aborted) throw new PlacesCancelled('Die Suche wurde abgebrochen');
      // The reason goes into the message, so the log and the app say what went wrong (time, name, connection).
      const cause = (err as { cause?: { code?: string } }).cause?.code;
      const why = (err as Error).name === 'TimeoutError' ? `nicht innerhalb von ${Math.round(this.timeoutMs / 1000)} s` : cause ? `nicht (${cause})` : 'nicht';
      throw new PlacesUnavailable(`Die Ortssuche antwortet ${why}`);
    }
    if (!res.ok) {
      // Photon says what it did not like ("language … is not supported"): pass it on, short.
      const text = await res.text().catch(() => '');
      let msg = text;
      try {
        msg = String((JSON.parse(text) as { message?: unknown }).message ?? text);
      } catch {
        // Not JSON: the text as it is.
      }
      msg = msg.replace(/\s+/g, ' ').trim().slice(0, 160);
      throw new PlacesUnavailable(`Die Ortssuche antwortet mit ${res.status}${msg && !msg.startsWith('<') ? `: ${msg}` : ''}`);
    }
    const body = (await res.json()) as { features?: PhotonFeature[] };
    return Array.isArray(body.features) ? body.features : [];
  }

  /** Places matching a text, the ones near the given position first. */
  async search(q: string, near?: { lat: number; lon: number }, limit = 6, signal?: AbortSignal): Promise<PlaceData[]> {
    const features = await this.get('api', { q, limit, lang: 'de', lat: near?.lat, lon: near?.lon }, signal);
    return features.map(placeFromPhoton).filter((p): p is PlaceData => p !== null);
  }

  /** What is at a position (the nearest address); without Photon just the position. */
  async reverse(lat: number, lon: number, signal?: AbortSignal): Promise<PlaceData> {
    const here: PlaceData = { name: 'Standort', address: null, lat, lon };
    if (!this.baseUrl) return here;
    try {
      const [hit] = (await this.get('reverse', { lat, lon, lang: 'de', limit: 1 }, signal)).map(placeFromPhoton);
      // The address belongs to the spot, the position stays the one that was measured.
      return hit ? { name: hit.name || 'Standort', address: hit.address, lat, lon } : here;
    } catch {
      return here;
    }
  }
}
