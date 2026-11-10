import { newAttachmentId, type PlaceData } from '@shopping/shared';
import { updateItem } from './actions';
import { showToast } from './toast';

/** Phones open places in the maps app (geo:), computers on OpenStreetMap. */
export const mobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent);

/** The device's position (asks for permission the first time). */
export function currentPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Dieses Gerät kennt seinen Standort nicht'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? 'Standort nicht freigegeben' : 'Standort nicht gefunden')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

/** Places matching a text (Photon via the server); empty when offline or not set up. */
export async function searchPlaces(q: string, near?: { lat: number; lon: number }): Promise<{ places: PlaceData[]; unavailable?: string }> {
  const params = new URLSearchParams({ q });
  if (near) {
    params.set('lat', String(near.lat));
    params.set('lon', String(near.lon));
  }
  const res = await fetch(`/api/v1/places/search?${params}`).catch(() => null);
  if (!res) return { places: [], unavailable: 'Keine Verbindung' };
  const body = (await res.json().catch(() => null)) as { places?: PlaceData[]; detail?: string } | null;
  if (!res.ok) return { places: [], unavailable: body?.detail ?? 'Ortssuche nicht erreichbar' };
  return { places: body?.places ?? [] };
}

/** Name and address of a position; just the position when that cannot be found out. */
export async function reversePlace(lat: number, lon: number): Promise<PlaceData> {
  const res = await fetch(`/api/v1/places/reverse?lat=${lat}&lon=${lon}`).catch(() => null);
  const body = res?.ok ? ((await res.json().catch(() => null)) as PlaceData | null) : null;
  return body ?? { name: 'Standort', address: null, lat, lon };
}

/** Attaches a place to an entry. */
export async function attachPlace(itemId: string, place: PlaceData, id = newAttachmentId()): Promise<void> {
  await updateItem(itemId, { attachments: { [id]: { id, type: 'place', ...place, at: new Date().toISOString() } } });
}

/**
 * "*": the current location goes on the entry right away (only the position), the address follows as
 * soon as it is known – the same attachment, updated.
 */
export async function attachHere(itemId: string): Promise<PlaceData | null> {
  let pos: { lat: number; lon: number };
  try {
    pos = await currentPosition();
  } catch (err) {
    showToast(`${(err as Error).message} – kein Ort angehängt`);
    return null;
  }
  const id = newAttachmentId();
  await attachPlace(itemId, { name: 'Standort', address: null, ...pos }, id);
  const named = await reversePlace(pos.lat, pos.lon);
  if (named.name !== 'Standort' || named.address) await attachPlace(itemId, named, id);
  return named;
}

/** "*Hornbach Altona": the best hit, if there is one. */
export async function attachSearched(itemId: string, query: string): Promise<boolean> {
  const { places, unavailable } = await searchPlaces(query);
  if (!places[0]) {
    showToast(unavailable ? `${unavailable} – „${query}“ nicht angehängt` : `Ort „${query}“ nicht gefunden`);
    return false;
  }
  await attachPlace(itemId, places[0]);
  return true;
}
