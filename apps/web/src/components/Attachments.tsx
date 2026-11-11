import {
  addLinkPatch,
  itemAttachments,
  placeLabel,
  placeUrl,
  removeAttachmentPatch,
  withUrl,
  itemUrl,
  isImage,
  formatSize,
  type Attachment,
  type FileAttachment,
  type ItemRow,
  type PlaceData,
} from '@shopping/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { updateItem } from '../actions';
import { attachFiles, useFileSrc, usePendingUpload } from '../files';
import { attachHere, attachPlace, mobile, searchPlaces } from '../places';

type Adding = null | 'menu' | 'link' | 'place';

const attachmentLabel = (a: Attachment) => (a.type === 'link' ? (a.title ?? a.url) : a.type === 'place' ? placeLabel(a) : a.name);

/**
 * The attachments of an entry in its details: without any just a button, otherwise exactly the ones there
 * are (pictures as previews, links, places, files) and a small "+ Anhang". Changes save right away.
 * Files can also be dropped onto the details or pasted (Strg+V).
 */
export function Attachments({ item }: { item: ItemRow }) {
  const all = itemAttachments(item);
  const pictures = all.filter((a): a is FileAttachment => a.type === 'file' && isImage(a));
  const rest = all.filter((a) => !(a.type === 'file' && isImage(a)));
  const [adding, setAdding] = useState<Adding>(null);
  const [viewing, setViewing] = useState<FileAttachment | null>(null);
  const closeView = useCallback(() => setViewing(null), []);
  const photo = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const remove = (a: Attachment) => void updateItem(item.id, removeAttachmentPatch(item, a.id));
  const take = (files: FileList | null) => {
    if (files?.length) void attachFiles(item.id, Array.from(files));
    setAdding(null);
  };

  // Strg+V with a picture or file while the details are open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      void attachFiles(item.id, files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [item.id]);

  return (
    <div className="attachments" aria-label="Anhänge">
      {pictures.length > 0 && (
        <ul className="attachments__pictures" aria-label="Bilder">
          {pictures.map((a) => (
            <Picture key={a.id} file={a} onOpen={() => setViewing(a)} onRemove={() => remove(a)} />
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <ul className="attachments__list">
          {rest.map((a) => (
            <li key={a.id} className={`attachment attachment--${a.type}`}>
              {a.type === 'link' ? (
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="attachment__main" title={a.url}>
                  <span aria-hidden>🔗</span>
                  <span className="attachment__text">
                    <span className="attachment__title">{a.title ?? hostOf(a.url)}</span>
                    <span className="attachment__sub">{a.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
                  </span>
                </a>
              ) : a.type === 'file' ? (
                <FileLink file={a} />
              ) : (
                <a href={placeUrl(a, mobile)} target="_blank" rel="noopener noreferrer" className="attachment__main">
                  <span aria-hidden>📍</span>
                  <span className="attachment__text">
                    <span className="attachment__title">{placeLabel(a)}</span>
                    {a.address && <span className="attachment__sub">{a.address}</span>}
                  </span>
                </a>
              )}
              <button type="button" className="attachment__remove" aria-label={`Anhang entfernen: ${attachmentLabel(a)}`} onClick={() => remove(a)}>
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
          <button type="button" className="chip" onClick={() => photo.current?.click()}>
            📷 Foto
          </button>
          <button type="button" className="chip" onClick={() => file.current?.click()}>
            📄 Datei
          </button>
          <button type="button" className="link" onClick={() => setAdding(null)}>
            Abbrechen
          </button>
        </div>
      )}
      {adding === 'link' && <LinkForm item={item} onDone={() => setAdding(null)} />}
      {adding === 'place' && <PlaceForm item={item} onDone={() => setAdding(null)} />}
      {/* On phones "Foto" offers the camera; both pick several at once. */}
      <input
        ref={photo}
        type="file"
        accept="image/*"
        capture={mobile ? 'environment' : undefined}
        multiple
        hidden
        aria-label="Foto"
        onChange={(e) => take(e.target.files)}
      />
      <input ref={file} type="file" multiple hidden aria-label="Datei" onChange={(e) => take(e.target.files)} />
      {viewing && <PictureView file={viewing} onClose={closeView} />}
    </div>
  );
}

function Picture({ file, onOpen, onRemove }: { file: FileAttachment; onOpen: () => void; onRemove: () => void }) {
  const src = useFileSrc(file.fileId, true);
  const pending = usePendingUpload(file.fileId);
  return (
    <li className={`attachment-picture${pending ? ' is-pending' : ''}`}>
      <button type="button" className="attachment-picture__open" onClick={onOpen} aria-label={`Bild ansehen: ${file.name}`} title={file.name}>
        <img src={src} alt="" loading="lazy" />
      </button>
      {pending && (
        <span className="attachment-picture__pending" title="Wird hochgeladen, sobald eine Verbindung da ist">
          ⏳
        </span>
      )}
      <button type="button" className="attachment-picture__remove" aria-label={`Anhang entfernen: ${file.name}`} onClick={onRemove}>
        ×
      </button>
    </li>
  );
}

function FileLink({ file }: { file: FileAttachment }) {
  const src = useFileSrc(file.fileId);
  const pending = usePendingUpload(file.fileId);
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" download={pending ? file.name : undefined} className="attachment__main" title={file.name}>
      <span aria-hidden>📄</span>
      <span className="attachment__text">
        <span className="attachment__title">{file.name}</span>
        <span className="attachment__sub">
          {formatSize(file.size)}
          {pending ? ' · wird hochgeladen, sobald eine Verbindung da ist' : ''}
        </span>
      </span>
    </a>
  );
}

/**
 * A picture large, over everything; a tap or Esc closes it. Not a dialog of its own: inside the details (a
 * modal dialog) a second one would be closed together with them by the same Esc.
 */
function PictureView({ file, onClose }: { file: FileAttachment; onClose: () => void }) {
  const src = useFileSrc(file.fileId);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Keeps the details open (their Esc is the default action of this key).
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      before?.focus();
    };
  }, [onClose]);
  return (
    <div className="picture-view" role="dialog" aria-modal="true" aria-label={file.name} onClick={onClose}>
      <img src={src} alt={file.name} />
      <div className="picture-view__bar" onClick={(e) => e.stopPropagation()}>
        <span className="picture-view__name">{file.name}</span>
        <a className="btn" href={`${src}${src.startsWith('blob:') ? '' : '?download=1'}`} download={file.name}>
          Herunterladen
        </a>
        <button ref={close} type="button" className="btn" onClick={onClose}>
          Schließen
        </button>
      </div>
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

  // Suggestions while typing (a pause first, so not every letter asks the server – Photon may be slow).
  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) {
      setHits([]);
      setNote(null);
      return;
    }
    let stale = false;
    const t = setTimeout(async () => {
      // A slow place search (a big database on a small server) can take a while: say it is still looking.
      setNote('Suche …');
      const res = await searchPlaces(query);
      if (stale) return;
      setHits(res.places);
      setNote(res.unavailable ?? (res.places.length ? null : 'Nichts gefunden'));
    }, 500);
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
    if (ok !== null) onDone();
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
