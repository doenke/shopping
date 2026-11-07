import { getCategory, type CatalogItem } from '@shopping/shared';
import { useCustomCategories } from '../../categories';
import { useMemo, useState } from 'react';
import { type ProviderId, PROVIDER_LABEL, type GalleryIcon, post } from './common';

interface GalleryProps {
  icons: GalleryIcon[];
  catalog: CatalogItem[];
  alternatives: ProviderId[];
  busy: boolean;
  run: (fn: () => Promise<string | void>) => Promise<void>;
}

export function Gallery({ icons, catalog, alternatives, busy, run }: GalleryProps) {
  const custom = useCustomCategories();
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const sel = icons.find((i) => i.id === selected);
  const shown = icons.filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase()));
  // Items without any icon yet, to order one directly.
  const without = useMemo(() => {
    if (search.length < 2) return [];
    const has = new Set(icons.map((i) => i.targetId));
    return catalog.filter((c) => !c.hidden && !has.has(c.id) && c.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8);
  }, [catalog, icons, search]);

  return (
    <section className="card">
      <h2>Freigegeben ({icons.length})</h2>
      <input className="gallery__search" placeholder="Artikel suchen …" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="gallery">
        {shown.map((i) => (
          <button
            key={i.id}
            type="button"
            className={`gallery__item${i.id === selected ? ' gallery__item--selected' : ''}`}
            style={{ '--cat': getCategory(i.categoryId, custom).color } as React.CSSProperties}
            onClick={() => setSelected(i.id === selected ? null : i.id)}
            title={i.name}
          >
            <img src={`/api/v1/icons/${i.id}/image`} alt="" width={56} height={56} loading="lazy" />
            <span>
              {i.isAnchor && '★ '}
              {i.name}
            </span>
          </button>
        ))}
      </div>
      {without.length > 0 && (
        <p>
          Noch ohne Icon:{' '}
          {without.map((c) => (
            <button
              key={c.id}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await post('/api/v1/icons/generate', { targetType: 'item', targetId: c.id });
                  return `„${c.name}“ ist in Auftrag.`;
                })
              }
            >
              + {c.name}
            </button>
          ))}
        </p>
      )}
      {sel && (
        <div className="row">
          <strong>{sel.name}</strong>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void run(async () => void (await post(`/api/v1/icons/${sel.id}/anchor`, { anchor: !sel.isAnchor })))}
          >
            {sel.isAnchor ? 'Keine Stil-Referenz mehr' : 'Als Stil-Referenz ★'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await post('/api/v1/icons/generate', { targetType: sel.targetType, targetId: sel.targetId });
                return `Neue Entwürfe für „${sel.name}“ sind in Auftrag. Bis zur Freigabe bleibt das jetzige Icon.`;
              })
            }
          >
            Neu erzeugen
          </button>
          {alternatives.map((p) => (
            <button
              key={p}
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => void (await post('/api/v1/icons/generate', { targetType: sel.targetType, targetId: sel.targetId, provider: p })))
              }
            >
              Mit {PROVIDER_LABEL[p]} neu
            </button>
          ))}
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => {
              if (!confirm(`Icon von „${sel.name}“ zurücknehmen? Die App zeigt dann wieder das Kategorie-Icon.`)) return;
              setSelected(null);
              void run(async () => void (await post(`/api/v1/icons/${sel.id}/reject`)));
            }}
          >
            Zurücknehmen
          </button>
        </div>
      )}
    </section>
  );
}
