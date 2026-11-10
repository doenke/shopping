import type { PlaceData } from '@shopping/shared';

/** Thrown when there is no place search (PHOTON_URL not set) or Photon does not answer. */
export class PlacesUnavailable extends Error {}

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
 */
export class PlaceService {
  constructor(
    private readonly baseUrl: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get available(): boolean {
    return !!this.baseUrl;
  }

  private async get(path: string, params: Record<string, string | number | undefined>): Promise<PhotonFeature[]> {
    if (!this.baseUrl) throw new PlacesUnavailable('Ortssuche ist nicht eingerichtet (PHOTON_URL)');
    const url = new URL(path, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' } });
    } catch {
      throw new PlacesUnavailable('Die Ortssuche antwortet nicht');
    }
    if (!res.ok) throw new PlacesUnavailable(`Die Ortssuche antwortet mit ${res.status}`);
    const body = (await res.json()) as { features?: PhotonFeature[] };
    return Array.isArray(body.features) ? body.features : [];
  }

  /** Places matching a text, the ones near the given position first. */
  async search(q: string, near?: { lat: number; lon: number }, limit = 6): Promise<PlaceData[]> {
    const features = await this.get('api', { q, limit, lang: 'de', lat: near?.lat, lon: near?.lon });
    return features.map(placeFromPhoton).filter((p): p is PlaceData => p !== null);
  }

  /** What is at a position (the nearest address); without Photon just the position. */
  async reverse(lat: number, lon: number): Promise<PlaceData> {
    const here: PlaceData = { name: 'Standort', address: null, lat, lon };
    if (!this.baseUrl) return here;
    try {
      const [hit] = (await this.get('reverse', { lat, lon, lang: 'de', limit: 1 })).map(placeFromPhoton);
      // The address belongs to the spot, the position stays the one that was measured.
      return hit ? { name: hit.name || 'Standort', address: hit.address, lat, lon } : here;
    } catch {
      return here;
    }
  }
}
