import {
  addLinkPatch,
  itemAttachments,
  placeLabel,
  placeUrl,
  removeAttachmentPatch,
  withUrl,
  itemUrl,
  type Attachment,
  type ItemRow,
  type PlaceData,
} from '@shopping/shared';
import { useEffect, useState } from 'react';
import { updateItem } from '../actions';
import { attachHere, attachPlace, mobile, searchPlaces } from '../places';

type Adding = null | 'menu' | 'link' | 'place';

/**
 * The attachments of an entry in its details: without any just a button, otherwise exactly the ones there
 * are (links, places) and a small "+ Anhang". Changes save right away.
 */
export function Attachments({ item }: { item: ItemRow }) {
  const all = itemAttachments(item);
  const [adding, setAdding] = useState<Adding>(null);

  const remove = (a: Attachment) => void updateItem(item.id, removeAttachmentPatch(item, a.id));

  return (
    <div className="attachments" aria-label="Anhänge">
      {all.length > 0 && (
        <ul className="attachments__list">
          {all.map((a) => (
            <li key={a.id} className={`attachment attachment--${a.type}`}>
              {a.type === 'link' ? (
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="attachment__main" title={a.url}>
                  <span aria-hidden>🔗</span>
                  <span className="attachment__text">
                    <span className="attachment__title">{a.title ?? hostOf(a.url)}</span>
                    <span className="attachment__sub">{a.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
                  </span>
                </a>
              ) : (
                <a href={placeUrl(a, mobile)} target="_blank" rel="noopener noreferrer" className="attachment__main">
                  <span aria-hidden>📍</span>
                  <span className="attachment__text">
                    <span className="attachment__title">{placeLabel(a)}</span>
                    {a.address && <span className="attachment__sub">{a.address}</span>}
                  </span>
                </a>
              )}
              <button
                type="button"
                className="attachment__remove"
                aria-label={`Anhang entfernen: ${a.type === 'link' ? (a.title ?? a.url) : placeLabel(a)}`}
                onClick={() => remove(a)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding === null && (
        <button type="button" className={all.length ? 'link attachments__more' : 'btn attachments__add'} onClick={() => setAdding('menu')}>
          {all.length ? '+ Anhang' : '📎 Anhang'}
        </button>
      )}
      {adding === 'menu' && (
        <div className="attachments__menu" role="group" aria-label="Anhang hinzufügen">
          <button type="button" className="chip" onClick={() => setAdding('link')}>
            🔗 Link
          </button>
          <button type="button" className="chip" onClick={() => setAdding('place')}>
            📍 Ort
          </button>
          <button type="button" className="link" onClick={() => setAdding(null)}>
            Abbrechen
          </button>
        </div>
      )}
      {adding === 'link' && <LinkForm item={item} onDone={() => setAdding(null)} />}
      {adding === 'place' && <PlaceForm item={item} onDone={() => setAdding(null)} />}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function LinkForm({ item, onDone }: { item: ItemRow; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const valid = itemUrl({ attributes: withUrl({}, url) });
  const add = () => {
    if (!valid) return;
    void updateItem(item.id, addLinkPatch(item, valid));
    onDone();
  };
  return (
    // No <form>: the details themselves are one (a form in a form would save the whole entry).
    <div className="attachments__form">
      <input
        type="url"
        inputMode="url"
        autoFocus
        aria-label="Link"
        placeholder="https://…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            add();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            onDone();
          }
        }}
      />
      <button type="button" className="btn" disabled={!valid} onClick={add}>
        Hinzufügen
      </button>
      <button type="button" className="link" onClick={onDone}>
        Abbrechen
      </button>
    </div>
  );
}

function PlaceForm({ item, onDone }: { item: ItemRow; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PlaceData[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  // Suggestions while typing (a short pause first, so not every letter asks the server).
  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) {
      setHits([]);
      setNote(null);
      return;
    }
    let stale = false;
    const t = setTimeout(async () => {
      const res = await searchPlaces(query);
      if (stale) return;
      setHits(res.places);
      setNote(res.unavailable ?? (res.places.length ? null : 'Nichts gefunden'));
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q]);

  const pick = (p: PlaceData) => {
    void attachPlace(item.id, p);
    onDone();
  };
  const here = async () => {
    setLocating(true);
    const ok = await attachHere(item.id);
    setLocating(false);
    if (ok) onDone();
  };

  return (
    <div className="attachments__form attachments__form--place">
      <div className="attachments__row">
        <input
          type="search"
          autoFocus
          aria-label="Ort suchen"
          placeholder="Ort suchen, z. B. Hornbach Altona"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              if (hits[0]) pick(hits[0]);
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              onDone();
            }
          }}
        />
        <button type="button" className="btn" onClick={() => void here()} disabled={locating}>
          {locating ? 'Suche Standort …' : '📍 Aktueller Standort'}
        </button>
        <button type="button" className="link" onClick={onDone}>
          Abbrechen
        </button>
      </div>
      {hits.length > 0 && (
        <ul className="attachments__hits" role="listbox" aria-label="Gefundene Orte">
          {hits.map((p, i) => (
            <li key={`${p.lat},${p.lon},${i}`}>
              <button type="button" role="option" aria-selected={i === 0} className="attachments__hit" onClick={() => pick(p)}>
                <span className="attachment__title">{placeLabel(p)}</span>
                {p.address && <span className="attachment__sub">{p.address}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="muted attachments__note">{note}</p>}
    </div>
  );
}
