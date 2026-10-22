import { describe, expect, it } from 'vitest';
import { formatAmounts, itemSpecification, mergeAmounts } from './amounts.js';
import { CatalogIndex } from './catalog-index.js';
import { Hlc } from './hlc.js';
import { applyPatch, ITEM_FIELDS, mergeRow } from './lww.js';
import type { CatalogItem } from './model.js';
import { parseInput, parseItem, splitInput } from './parser.js';
import { planAdd } from './plan-add.js';
import { seedCatalog } from './seed-catalog.js';

const catalog: CatalogItem[] = seedCatalog().map((s, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  name: s.name,
  plural: null,
  categoryId: s.categoryId,
  defaultUnit: s.defaultUnit,
  aliases: s.aliases,
  pantry: s.pantry,
  source: 'seed',
  mealieFoodId: null,
  hidden: false,
  seq: 0,
}));
const index = new CatalogIndex(catalog);

describe('parser', () => {
  const cases: [string, string, string][] = [
    ['Milch', 'Milch', ''],
    ['2 l Milch', 'Milch', '2 l'],
    ['Milch 2l laktosefrei', 'Milch', '2 l · laktosefrei'],
    ['500g Hack gemischt bio', 'Hackfleisch', '500 g · gemischt · bio'],
    ['3 Zwiebeln', 'Zwiebeln', '3'],
    ['1/2 Bund Petersilie', 'Petersilie', '½ Bund'],
    ['Tomaten (die kleinen)', 'Tomaten', 'die kleinen'],
    ['1,5 kg Kartoffeln festkochend', 'Kartoffeln', '1,5 kg · festkochend'],
    ['2 Dosen Kidneybohnen', 'Kidneybohnen', '2 Dosen'],
    ['zwei Gurken', 'Gurke', '2'],
    ['kartofeln', 'Kartoffeln', ''],
    ['Klopapier', 'Toilettenpapier', ''],
    ['Spezialzeug von Oma', 'Spezialzeug von Oma', ''],
    ['TK Erbsen', 'Erbsen', 'TK'],
  ];
  for (const [input, name, spec] of cases) {
    it(`parses "${input}"`, () => {
      const p = parseItem(input, index)!;
      expect(p.name).toBe(name);
      expect(itemSpecification(p)).toBe(spec);
    });
  }

  it('splits lists but keeps decimal commas', () => {
    expect(splitInput('Kaffee, Butter, 6 Eier; 1,5 kg Mehl')).toEqual(['Kaffee', 'Butter', '6 Eier', '1,5 kg Mehl']);
    expect(parseInput('Kaffee, Butter, 6 Eier', index).map((p) => p.name)).toEqual(['Kaffee', 'Butter', 'Eier']);
  });

  it('works without catalog', () => {
    expect(parseItem('2 kg kartoffeln')).toMatchObject({ name: 'Kartoffeln', catalogItemId: null, amounts: [{ q: 2, u: 'kg' }] });
  });

  it('assigns category from catalog', () => {
    expect(parseItem('Bananen', index)?.categoryId).toBe('obst-gemuese');
  });
});

describe('amounts', () => {
  it('adds compatible units and normalizes', () => {
    expect(mergeAmounts([{ q: 200, u: 'g' }], [{ q: 1, u: 'kg' }])).toEqual([{ q: 1.2, u: 'kg' }]);
    expect(mergeAmounts([{ q: 500, u: 'ml' }], [{ q: 500, u: 'ml' }])).toEqual([{ q: 1, u: 'l' }]);
  });
  it('treats missing unit as pieces', () => {
    expect(mergeAmounts([{ q: 2, u: null }], [{ q: 1, u: 'stk' }])).toEqual([{ q: 3, u: 'stk' }]);
  });
  it('keeps incompatible amounts side by side', () => {
    const r = mergeAmounts([{ q: 2, u: null }], [{ q: 200, u: 'g' }]);
    expect(formatAmounts(r)).toBe('2 + 200 g');
  });
  it('merges with empty amounts', () => {
    expect(mergeAmounts([], [{ q: 2, u: 'l' }])).toEqual([{ q: 2, u: 'l' }]);
  });
});

describe('hlc', () => {
  it('is monotonic even if the wall clock goes backwards', () => {
    let now = 1000;
    const clock = new Hlc('a', () => now);
    const t1 = clock.tick();
    now = 500;
    const t2 = clock.tick();
    expect(t2 > t1).toBe(true);
  });
  it('moves past received timestamps', () => {
    const a = new Hlc('a', () => 1000);
    const b = new Hlc('b', () => 10);
    const ta = a.tick();
    b.receive(ta);
    expect(b.tick() > ta).toBe(true);
  });
});

describe('lww', () => {
  const base = () => ({ name: 'Milch', checked: false, note: null as string | null, hlc: {} as Record<string, string> });

  it('merges concurrent edits of different fields', () => {
    const a = base();
    const b = base();
    applyPatch(a, { checked: true }, '0000000001000:0000:a');
    applyPatch(b, { note: 'laktosefrei' }, '0000000001001:0000:b');
    const ab = mergeRow(a, b, ITEM_FIELDS);
    const ba = mergeRow(b, a, ITEM_FIELDS);
    expect(ab).toEqual(ba);
    expect(ab).toMatchObject({ checked: true, note: 'laktosefrei' });
  });

  it('keeps the newer write of the same field', () => {
    const row = base();
    applyPatch(row, { name: 'Neu' }, '0000000002000:0000:a');
    expect(applyPatch(row, { name: 'Alt' }, '0000000001000:0000:b')).toEqual([]);
    expect(row.name).toBe('Neu');
  });
});

describe('planAdd', () => {
  let n = 0;
  const id = () => `new-${++n}`;
  const base = { catalogItemId: null, deleted: false, amounts: [], properties: [], note: null, attributes: {}, position: 'a0' };

  it('adds to open items, brings back bought ones, creates the rest', () => {
    const existing = [
      { ...base, id: 'milk', name: 'Milch', checked: false, amounts: [{ q: 1, u: 'l' }] },
      { ...base, id: 'bread', name: 'Brot', checked: true, position: 'a1' },
    ];
    const plan = planAdd('L', existing, parseInput('2 l Milch, Brot, Käse, Käse'), id);
    expect(plan.map((c) => [c.id, c.kind])).toEqual([
      ['milk', 'merged'],
      ['bread', 'restored'],
      ['new-1', 'created'],
    ]);
    expect(plan[0]!.patch.amounts).toEqual([{ q: 3, u: 'l' }]);
    expect(plan[2]!.patch.position! > 'a1').toBe(true);
  });
});
