import { describe, expect, it } from 'vitest';
import { formatAmounts, itemSpecification, mergeAmounts } from './amounts.js';
import { CatalogIndex } from './catalog-index.js';
import { Hlc } from './hlc.js';
import { applyPatch, ITEM_FIELDS, mergeRow } from './lww.js';
import type { CatalogItem } from './model.js';
import { parseInput, parseItem, splitInput } from './parser.js';
import { categoriesFor, categoryInList, getCategory, nextCategoryColor } from './categories.js';
import { isOwnName } from './catalog-index.js';
import { extractDue, formatDue, parseDue } from './due.js';
import { defaultVisibility } from './packing.js';
import { planAdd } from './plan-add.js';
import { suggestedProperties } from './properties.js';
import { listAsText } from './list-text.js';
import type { ItemRow } from './model.js';
import { seedCatalog } from './seed-catalog.js';

const catalog: CatalogItem[] = seedCatalog()
  .filter((s) => s.kind === 'shopping')
  .map((s, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  name: s.name,
  plural: null,
  categoryId: s.categoryId,
  defaultUnit: s.defaultUnit,
  aliases: s.aliases,
  pantry: s.pantry,
  source: 'seed',
  mealieFoodId: null,
  icon: null,
  kind: s.kind,
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

describe('packing lists', () => {
  const packing: CatalogItem[] = seedCatalog()
    .filter((s) => s.kind === 'packing')
    .map((s, i) => ({ ...catalog[0]!, id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`, name: s.name, aliases: s.aliases, categoryId: s.categoryId, kind: 'packing' as const }));
  const index = new CatalogIndex(packing);

  it('reads person and Packstück from the input', () => {
    const [shirts, brush] = parseInput('3 T-Shirts @anna #Koffer, Zahnbürste @Ben #Blaue_Tasche', index);
    expect(shirts).toMatchObject({ name: 'T-Shirts', amounts: [{ q: 3, u: null }], person: 'Anna', container: 'Koffer', categoryId: 'kleidung' });
    expect(brush).toMatchObject({ name: 'Zahnbürste', person: 'Ben', container: 'Blaue Tasche', categoryId: 'koerperpflege' });
    expect(parseItem('Socken', index)).not.toHaveProperty('person');
  });

  it('keeps items of different people or Packstücke apart', () => {
    let n = 0;
    const newId = () => `id-${++n}`;
    const first = planAdd('l', [], parseInput('2 T-Shirts @Anna, 2 T-Shirts @Ben', index), newId);
    expect(first.map((c) => c.kind)).toEqual(['created', 'created']);
    expect(first[0]!.patch.attributes).toEqual({ person: 'Anna' });
    const existing = first.map((c) => ({
      id: c.id,
      catalogItemId: c.patch.catalogItemId ?? null,
      name: c.patch.name!,
      checked: false,
      deleted: false,
      amounts: c.patch.amounts!,
      properties: [],
      note: null,
      attributes: c.patch.attributes ?? {},
      position: c.patch.position!,
    }));
    const more = planAdd('l', existing, parseInput('1 T-Shirts @anna, T-Shirts #Koffer', index), newId);
    expect(more[0]).toMatchObject({ id: 'id-1', kind: 'merged', patch: { amounts: [{ q: 3, u: null }] } });
    expect(more[1]).toMatchObject({ kind: 'created', patch: { attributes: { container: 'Koffer' } } });
  });

  it('sorts unknown categories of a packing list into "Sonstiges"', () => {
    expect(categoryInList('obst-gemuese', 'packing').id).toBe('packen-sonstiges');
    expect(categoryInList('technik', 'packing').name).toBe('Technik');
    expect(categoriesFor('shopping')).toHaveLength(14);
  });

  it('tells the own name of an item from a synonym', () => {
    const lamp = { id: 'l', name: 'Taschenlampe', plural: 'Taschenlampen', aliases: ['Stirnlampe'], categoryId: 'technik', defaultUnit: null, pantry: false, source: 'seed' as const, mealieFoodId: null, hidden: false, kind: 'packing' as const, icon: null, seq: 0 };
    expect(isOwnName(lamp, 'taschenlampen')).toBe(true);
    expect(isOwnName(lamp, 'Stirnlampe')).toBe(false);
    // An item of its own beats the synonym.
    const head = { ...lamp, id: 's', name: 'Stirnlampe', plural: null, aliases: [] };
    expect(new CatalogIndex([lamp, head]).match('Stirnlampe')?.id).toBe('s');
    expect(new CatalogIndex([lamp, head]).search('Stirnlampe').map((i) => i.id)).toContain('l');
  });

  it('puts own categories before the catch-all and forgets deleted ones', () => {
    const own = (id: string, name: string, listType: 'shopping' | 'packing', deleted = false) => ({
      id, name, listType, color: '#5BAA45', ownerId: 'u', deleted, hlc: {}, seq: 0,
    });
    const custom = [own('c1', 'Zelten', 'packing'), own('c2', 'Angeln', 'packing'), own('c3', 'Weg', 'packing', true), own('c4', 'Asia-Laden', 'shopping')];
    const packing = categoriesFor('packing', custom).map((c) => c.name);
    expect(packing.slice(-3)).toEqual(['Angeln', 'Zelten', 'Sonstiges']);
    expect(packing).not.toContain('Weg');
    expect(categoryInList('c1', 'packing', custom)).toMatchObject({ name: 'Zelten', custom: true });
    expect(categoryInList('c3', 'packing', custom).id).toBe('packen-sonstiges');
    expect(categoryInList('c4', 'packing', custom).id).toBe('packen-sonstiges');
    expect(getCategory('c4', custom).name).toBe('Asia-Laden');
    expect(nextCategoryColor('packing', custom)).not.toBe('#5BAA45');
  });
});

describe('due dates (ToDo lists)', () => {
  // Wednesday, 2026-11-11
  const now = new Date(2026, 10, 11, 9, 0);

  it('understands relative days, weekdays and dates', () => {
    expect(parseDue('heute', now)).toBe('2026-11-11');
    expect(parseDue('morgen', now)).toBe('2026-11-12');
    expect(parseDue('gestern', now)).toBe('2026-11-10');
    expect(parseDue('Fr', now)).toBe('2026-11-13');
    expect(parseDue('mittwoch', now)).toBe('2026-11-18'); // today's weekday → next week
    expect(parseDue('24.12.', now)).toBe('2026-12-24');
    expect(parseDue('5.1.', now)).toBe('2027-01-05'); // already past this year
    expect(parseDue('2026-12-01', now)).toBe('2026-12-01');
    expect(parseDue('Hallo', now)).toBeNull();
    expect(parseDue('32.1.', now)).toBeNull();
  });

  it('is typed with "!" and goes into the item', () => {
    expect(extractDue('Steuer machen !Fr @Anna', now)).toEqual({ text: 'Steuer machen @Anna', due: '2026-11-13' });
    expect(extractDue('Achtung!', now)).toEqual({ text: 'Achtung!', due: null });
    const [task] = parseInput('Reifen wechseln !morgen @Ben #Auto');
    expect(task).toMatchObject({ name: 'Reifen wechseln', person: 'Ben', container: 'Auto' });
    expect(task!.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [plan] = planAdd('l', [], [task!], () => 'x');
    expect(plan!.patch.attributes).toMatchObject({ person: 'Ben', container: 'Auto', due: task!.due });
  });

  it('formats for the list', () => {
    expect(formatDue('2026-11-11', now)).toMatchObject({ label: 'Heute', today: true, overdue: false });
    expect(formatDue('2026-11-10', now)).toMatchObject({ label: 'Gestern', overdue: true });
    expect(formatDue('2026-11-12', now).label).toBe('Morgen');
  });

  it('makes ToDo lists private by default', () => {
    expect(defaultVisibility('todo')).toBe('private');
    expect(defaultVisibility('shopping')).toBe('household');
  });
});

describe('properties per list type', () => {
  it('knows grocery words only on shopping lists', () => {
    expect(parseItem('Kartoffeln festkochend bio')).toMatchObject({ name: 'Kartoffeln', properties: ['festkochend', 'bio'] });
    // Merkliste: a title stays a title.
    expect(parseItem('Der kleine Prinz', undefined, 'memo')).toMatchObject({ name: 'Der kleine Prinz', properties: [] });
  });

  it('has its own words on packing and ToDo lists', () => {
    expect(parseItem('Powerbank aufladen @Anna', undefined, 'packing')).toMatchObject({ name: 'Powerbank', properties: ['aufladen'], person: 'Anna' });
    expect(parseItem('Sonnencreme kaufen', undefined, 'packing')).toMatchObject({ name: 'Sonnencreme', properties: ['kaufen'] });
    expect(parseItem('Kleine Tasche', undefined, 'packing')).toMatchObject({ name: 'Kleine Tasche', properties: [] });
    expect(parseItem('dringend Steuererklärung abgeben', undefined, 'todo')).toMatchObject({ name: 'Steuererklärung abgeben', properties: ['dringend'] });
    expect(parseInput('Reifen wechseln bio', undefined, 'todo')[0]).toMatchObject({ name: 'Reifen wechseln bio', properties: [] });
  });

  it('suggests fitting chips', () => {
    expect(suggestedProperties('shopping')).toContain('bio');
    expect(suggestedProperties('packing')).toContain('Handgepäck');
    expect(suggestedProperties('memo')).not.toContain('bio');
    expect(suggestedProperties('todo')).toContain('dringend');
  });
});

describe('list as text', () => {
  let n = 0;
  const item = (p: Partial<ItemRow>): ItemRow => ({
    id: `i${++n}`,
    listId: 'l',
    catalogItemId: null,
    name: '?',
    amounts: [],
    properties: [],
    note: null,
    categoryId: null,
    checked: false,
    checkedAt: null,
    checkedBy: null,
    position: `a${n}`,
    optional: false,
    attributes: {},
    createdBy: null,
    createdAt: '',
    deleted: false,
    mergedInto: null,
    hlc: {},
    seq: 0,
    ...p,
  });
  const list = (listType: 'shopping' | 'packing' | 'memo' | 'todo', settings = {}) => ({ name: 'Wocheneinkauf', listType, isTemplate: false, settings });

  it('groups open items by category, in the user order', () => {
    const items = [
      item({ name: 'Milch', categoryId: 'milch-kaese', amounts: [{ q: 1, u: 'l' }], properties: ['laktosefrei'] }),
      item({ name: 'Kartoffeln', categoryId: 'obst-gemuese', amounts: [{ q: 2, u: 'kg' }] }),
      item({ name: 'Butter', categoryId: 'milch-kaese', checked: true }),
    ];
    expect(listAsText(list('shopping', { description: 'Für die Woche' }), items, ['milch-kaese'])).toBe(
      'Wocheneinkauf\nFür die Woche\n\nMilch & Käse\n• Milch – 1 l · laktosefrei\n\nObst & Gemüse\n• Kartoffeln – 2 kg',
    );
  });

  it('shows who and where, due dates on ToDo lists, and nothing open', () => {
    expect(listAsText(list('memo'), [item({ name: 'Dune', attributes: { person: 'Ben', container: 'Netflix' } })])).toBe(
      'Wocheneinkauf\n\n• Dune (Tipp von Ben, Netflix)',
    );
    const now = new Date(2026, 9, 26);
    const todo = [item({ name: 'Steuer' }), item({ name: 'Reifen', attributes: { due: '2026-10-27', person: 'Ben' } })];
    expect(listAsText(list('todo'), todo, [], now)).toBe('Wocheneinkauf\n\n• Reifen – Morgen (Ben)\n• Steuer');
    expect(listAsText(list('shopping'), [item({ name: 'Milch', checked: true })])).toBe('Wocheneinkauf\n\nAlles erledigt.');
  });
});
