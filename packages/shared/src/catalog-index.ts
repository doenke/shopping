import type { CatalogItem } from './model.js';

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rough German singular/plural variants: "Zwiebeln" ~ "Zwiebel", "Eier" ~ "Ei". */
export function stems(word: string): string[] {
  const out = new Set([word]);
  for (const suffix of ['en', 'n', 'e', 's', 'er', 'nen']) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) out.add(word.slice(0, -suffix.length));
  }
  for (const suffix of ['n', 'en', 'e', 's']) out.add(word + suffix);
  return [...out];
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
  return set;
}

export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / (ta.size + tb.size - common);
}

type IndexEntry = { key: string; item: CatalogItem };

export class CatalogIndex {
  private readonly entries: IndexEntry[] = [];
  private readonly exact = new Map<string, CatalogItem>();

  constructor(items: Iterable<CatalogItem>) {
    for (const item of items) {
      if (item.hidden) continue;
      for (const term of [item.name, item.plural, ...item.aliases]) {
        if (!term) continue;
        const key = normalize(term);
        if (!key) continue;
        this.entries.push({ key, item });
        if (!this.exact.has(key)) this.exact.set(key, item);
      }
    }
  }

  get size(): number {
    return this.exact.size;
  }

  /** Finds the catalog item a phrase denotes, or undefined if unsure. */
  match(phrase: string, fuzzy = true): CatalogItem | undefined {
    const key = normalize(phrase);
    if (!key) return undefined;
    const hit = this.exact.get(key);
    if (hit) return hit;
    const words = key.split(' ');
    const last = words.pop()!;
    for (const variant of stems(last)) {
      const v = this.exact.get([...words, variant].join(' '));
      if (v) return v;
    }
    if (!fuzzy || key.length < 4) return undefined;
    let best: { item: CatalogItem; score: number } | undefined;
    for (const e of this.entries) {
      if (Math.abs(e.key.length - key.length) > 3) continue;
      const score = similarity(key, e.key);
      if (score >= 0.55 && (!best || score > best.score)) best = { item: e.item, score };
    }
    return best?.item;
  }

  /**
   * Autocomplete search. `boost` lets callers rank frequently used items higher.
   */
  search(query: string, limit = 12, boost?: (item: CatalogItem) => number): CatalogItem[] {
    const q = normalize(query);
    if (!q) return [];
    const scores = new Map<CatalogItem, number>();
    for (const e of this.entries) {
      let score = 0;
      if (e.key === q) score = 100;
      else if (e.key.startsWith(q)) score = 80 - Math.min(e.key.length - q.length, 20);
      else if (e.key.split(' ').some((w) => w.startsWith(q))) score = 60;
      else if (q.length >= 3 && e.key.includes(q)) score = 40;
      else if (q.length >= 4) {
        const sim = similarity(q, e.key);
        if (sim >= 0.35) score = sim * 50;
      }
      if (score > 0) {
        const total = score + (boost?.(e.item) ?? 0);
        if (total > (scores.get(e.item) ?? 0)) scores.set(e.item, total);
      }
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name, 'de'))
      .slice(0, limit)
      .map(([item]) => item);
  }
}
