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
import { findStatus, itemStatus, listDefaultStatus, listStatuses, withStatus } from './status.js';
import { itemToIcal, parseIcalTodo, taskPatch, taskTitle } from './ical.js';
import { findUrl, itemUrl, linkLabel, withUrl } from './links.js';
import { applyItemPatch, itemDone, mergeItem, peopleLabel, resolvePeople, withPeople } from './people.js';
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
    .map((s, i) => ({
      ...catalog[0]!,
      id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`,
      name: s.name,
      aliases: s.aliases,
      categoryId: s.categoryId,
      kind: 'packing' as const,
    }));
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
    const lamp = {
      id: 'l',
      name: 'Taschenlampe',
      plural: 'Taschenlampen',
      aliases: ['Stirnlampe'],
      categoryId: 'technik',
      defaultUnit: null,
      pantry: false,
      source: 'seed' as const,
      mealieFoodId: null,
      hidden: false,
      kind: 'packing' as const,
      icon: null,
      seq: 0,
    };
    expect(isOwnName(lamp, 'taschenlampen')).toBe(true);
    expect(isOwnName(lamp, 'Stirnlampe')).toBe(false);
    // An item of its own beats the synonym.
    const head = { ...lamp, id: 's', name: 'Stirnlampe', plural: null, aliases: [] };
    expect(new CatalogIndex([lamp, head]).match('Stirnlampe')?.id).toBe('s');
    expect(new CatalogIndex([lamp, head]).search('Stirnlampe').map((i) => i.id)).toContain('l');
  });

  it('puts own categories before the catch-all and forgets deleted ones', () => {
    const own = (id: string, name: string, listType: 'shopping' | 'packing', deleted = false) => ({
      id,
      name,
      listType,
      color: '#5BAA45',
      ownerId: 'u',
      deleted,
      hlc: {},
      seq: 0,
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

describe('a pasted ingredient list', () => {
  it('becomes one item per line, with amounts, units and notes', () => {
    const block =
      '1 Zehe(n)\tKnoblauch\n30 g\tPetersilie (glatt)\n100 g\tButter (Zimmertemperatur)\n200 g Bergkäse, gerieben\n1,5 kg Kartoffeln\nSalz\n\n• 2 EL\tButterschmalz\n';
    const items = parseInput(block, index);
    expect(items.map((i) => i.name)).toEqual(['Knoblauch', 'Petersilie', 'Butter', 'Bergkäse', 'Kartoffeln', 'Salz', 'Butterschmalz']);
    expect(items[0]).toMatchObject({ amounts: [{ q: 1, u: 'zehe' }], note: null });
    expect(items[1]).toMatchObject({ amounts: [{ q: 30, u: 'g' }], note: 'glatt' });
    expect(items[3]).toMatchObject({ amounts: [{ q: 200, u: 'g' }], note: 'gerieben' });
    expect(items[4]!.amounts).toEqual([{ q: 1.5, u: 'kg' }]);
    expect(items[6]!.amounts).toEqual([{ q: 2, u: 'el' }]);
  });

  it('still splits a single line at commas', () => {
    expect(parseInput('Milch, Butter, 6 Eier', index).map((i) => i.name)).toEqual(['Milch', 'Butter', 'Eier']);
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

describe('recurring checklists', () => {
  it('start each period at midnight in Berlin', async () => {
    const { resetPeriodStart } = await import('./recurring.js');
    // Thu 2026-11-12 10:00 Berlin (CET, UTC+1)
    const now = new Date('2026-11-12T09:00:00Z');
    expect(resetPeriodStart('daily', now).toISOString()).toBe('2026-11-11T23:00:00.000Z');
    expect(resetPeriodStart('weekly', now).toISOString()).toBe('2026-11-08T23:00:00.000Z'); // Mon 9.11.
    expect(resetPeriodStart('monthly', now).toISOString()).toBe('2026-10-31T23:00:00.000Z');
    // Summer time (UTC+2), shortly after midnight Berlin on a Monday
    const summer = new Date('2026-06-14T22:30:00Z'); // Mon 15.6. 00:30
    expect(resetPeriodStart('daily', summer).toISOString()).toBe('2026-06-14T22:00:00.000Z');
    expect(resetPeriodStart('weekly', summer).toISOString()).toBe('2026-06-14T22:00:00.000Z');
  });

  it('only for ToDo lists', async () => {
    const { listReset } = await import('./recurring.js');
    expect(listReset({ listType: 'todo', isTemplate: false, settings: { reset: 'weekly' } })).toBe('weekly');
    expect(listReset({ listType: 'shopping', isTemplate: false, settings: { reset: 'weekly' } })).toBeNull();
    expect(listReset({ listType: 'packing', isTemplate: false, settings: { reset: 'daily' } })).toBeNull();
    expect(listReset({ listType: 'todo', isTemplate: true, settings: { reset: 'daily' } })).toBeNull();
    expect(listReset({ listType: 'packing', isTemplate: false, settings: { reset: 'yearly' } })).toBeNull();
  });
});

describe('things for several people', () => {
  const item = (attributes: Record<string, unknown>, checked = false): ItemRow => ({
    id: 'i',
    listId: 'l',
    catalogItemId: null,
    name: 'Sonnenbrille',
    amounts: [],
    properties: [],
    note: null,
    categoryId: null,
    checked,
    checkedAt: null,
    checkedBy: null,
    position: 'a0',
    optional: false,
    attributes,
    createdBy: null,
    createdAt: '',
    deleted: false,
    mergedInto: null,
    hlc: {},
    seq: 0,
  });

  it('reads several people and "@alle" from the input', () => {
    expect(parseItem('Sonnenbrille @sönke @Ulli')).toMatchObject({ person: 'Sönke', persons: ['Sönke', 'Ulli'] });
    expect(parseItem('Sonnenbrille @alle')).toMatchObject({ forEach: true });
    expect(parseItem('Sonnenbrille @alle')).not.toHaveProperty('person');
    expect(parseItem('Dune @Anna @Ben', undefined, 'memo')).not.toHaveProperty('persons');
  });

  it('ticks off per person; the item is done when everyone is', () => {
    const row = item({ persons: ['Sönke', 'Ulli'] });
    expect(applyItemPatch(row, { personChecks: { sönke: true } }, '0000000000001:0000:a')).toContain('attributes');
    expect(itemDone(row)).toEqual(['Sönke']);
    expect(row.checked).toBe(false);
    expect(applyItemPatch(row, { personChecks: { Ulli: true } }, '0000000000002:0000:b')).toContain('checked');
    expect(row.checked).toBe(true);
    // Unticking the whole item opens it for everyone.
    applyItemPatch(row, { checked: false }, '0000000000003:0000:a');
    expect(itemDone(row)).toEqual([]);
    expect(row.checked).toBe(false);
    // Checking the whole item ticks everyone.
    applyItemPatch(row, { checked: true }, '0000000000004:0000:a');
    expect(itemDone(row)).toEqual(['Sönke', 'Ulli']);
  });

  it('two people ticking at the same time do not overwrite each other', () => {
    const server = item({ persons: ['Sönke', 'Ulli'] });
    applyItemPatch(server, { personChecks: { Ulli: true } }, '0000000000005:0000:b');
    applyItemPatch(server, { personChecks: { Sönke: true } }, '0000000000004:0000:a');
    expect(server.checked).toBe(true);
    // An older edit of the attributes does not take ticks away.
    applyItemPatch(server, { attributes: { persons: ['Sönke', 'Ulli'], note: 'x' } }, '0000000000006:0000:c');
    expect(itemDone(server)).toEqual(['Sönke', 'Ulli']);
    // The app keeps its own newer tick when the server's copy arrives.
    const local = item({ persons: ['Sönke', 'Ulli'] });
    applyItemPatch(local, { personChecks: { Sönke: true } }, '0000000000007:0000:a');
    const incoming = item({ persons: ['Sönke', 'Ulli'], done: ['Ulli'] });
    incoming.hlc = { 'done:ulli': '0000000000005:0000:b', attributes: '0000000000006:0000:c' };
    const merged = mergeItem(local, incoming, ITEM_FIELDS);
    expect(itemDone(merged)).toEqual(['Sönke', 'Ulli']);
    expect(merged.checked).toBe(true);
  });

  it('merges more people into one entry instead of a second one', () => {
    const existing = [{ ...item({ persons: ['Sönke', 'Ulli'], done: ['Ulli'] }), amounts: [{ q: 1, u: null }] }];
    const plan = planAdd('l', existing, parseInput('Sonnenbrille @Anna, 2 Sonnenbrille @Ulli'), () => 'new');
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ id: 'i', kind: 'merged', patch: { attributes: { persons: ['Sönke', 'Ulli', 'Anna'], done: ['Ulli'] } } });
    expect(plan[1]).toMatchObject({ id: 'i', patch: { personChecks: { Ulli: false } } });
    expect(plan[1]!.patch.amounts).toBeUndefined();
    // Single people stay apart as before.
    expect(planAdd('l', [item({ person: 'Anna' })], parseInput('Sonnenbrille @Ben'), () => 'n')[0]!.kind).toBe('created');
  });

  it('turns "für jeden" into the people of the list and back', () => {
    expect(resolvePeople({ name: 'x', forEach: true }, { isTemplate: false, persons: ['Sönke', 'Ulli'] })).toEqual({ name: 'x', persons: ['Sönke', 'Ulli'] });
    expect(resolvePeople({ name: 'x', forEach: true }, { isTemplate: false, persons: ['Anna'] })).toEqual({ name: 'x', person: 'Anna' });
    expect(resolvePeople({ name: 'x', persons: ['A', 'B'], person: 'A' }, { isTemplate: true, persons: [] })).toEqual({ name: 'x', forEach: true });
    expect(peopleLabel(item({ forEach: true }))).toBe('für jeden');
    expect(peopleLabel(item({ persons: ['Sönke', 'Ulli'] }))).toBe('Sönke + Ulli');
    expect(withPeople({ persons: ['A', 'B'], done: ['A', 'B'] }, ['A', 'C'])).toEqual({ persons: ['A', 'C'], done: ['A'] });
  });
});

describe('links on items', () => {
  it('takes the link out of the text', () => {
    expect(parseInput('Dune https://www.imdb.com/title/tt1160419/?ref=a,b @Ben #Netflix', undefined, 'memo')).toEqual([
      expect.objectContaining({ name: 'Dune', url: 'https://www.imdb.com/title/tt1160419/?ref=a,b', person: 'Ben', container: 'Netflix' }),
    ]);
    expect(parseItem('https://www.example.org/x#teil')).toMatchObject({ name: 'example.org', url: 'https://www.example.org/x#teil' });
    expect(findUrl('Schau mal (https://a.de/b).')).toBe('https://a.de/b');
  });

  it('keeps links valid and adds them to existing entries', () => {
    expect(itemUrl({ attributes: { url: 'javascript:alert(1)' } })).toBeNull();
    expect(itemUrl({ attributes: { url: 'https://a.de/b' } })).toBe('https://a.de/b');
    expect(withUrl({}, 'kino.de/film')).toEqual({ url: 'https://kino.de/film' });
    expect(linkLabel('https://www.Netflix.com/title/1')).toBe('netflix.com');
    const base = { catalogItemId: null, deleted: false, amounts: [], properties: [], note: null, position: 'a0', checked: false };
    const plan = planAdd('l', [{ ...base, id: 'd', name: 'Dune', attributes: {} }], parseInput('Dune https://a.de/dune', undefined, 'memo'), () => 'n');
    expect(plan).toEqual([expect.objectContaining({ id: 'd', patch: { attributes: { url: 'https://a.de/dune' } } })]);
  });
});

describe('entries as tasks (CalDAV/JMAP)', () => {
  const row: ItemRow = {
    id: '11111111-1111-4111-8111-111111111111',
    listId: 'l',
    catalogItemId: null,
    name: 'Reifen wechseln',
    amounts: [],
    properties: [],
    note: 'Schrauben, Muttern; Werkzeug\nim Keller',
    categoryId: null,
    checked: false,
    checkedAt: null,
    checkedBy: null,
    position: 'a0',
    optional: false,
    attributes: { due: '2026-11-13', url: 'https://a.de/x', container: 'Auto', person: 'Ben' },
    createdBy: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    deleted: false,
    mergedInto: null,
    hlc: { name: '1793900000000:0000:a' },
    seq: 5,
  };

  it('writes a VTODO and reads it back', () => {
    const ics = itemToIcal(row, { name: 'Aufgaben', listType: 'todo' }, new Date('2026-11-08T12:00:00Z'));
    expect(ics).toContain('SUMMARY:Reifen wechseln – Ben\r\n');
    expect(ics).toContain('DUE;VALUE=DATE:20261113');
    expect(ics.replace(/\r\n /g, '')).toContain('DESCRIPTION:Schrauben\\, Muttern\\; Werkzeug\\nim Keller');
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
    expect(ics).toContain('STATUS:NEEDS-ACTION');
    const back = parseIcalTodo(ics)!;
    expect(back).toEqual({
      uid: row.id,
      summary: 'Reifen wechseln – Ben',
      description: 'Schrauben, Muttern; Werkzeug\nim Keller',
      completed: false,
      due: '2026-11-13',
      url: 'https://a.de/x',
    });
    // Unchanged: nothing to do.
    expect(taskPatch(row, 'todo', back, (t) => parseItem(t))).toEqual({});
  });

  it('takes over what a task app changed', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VTODO',
      'UID:abc',
      'SUMMARY:Sommerreifen wechseln',
      'DUE;TZID=Europe/Berlin:20261114T090000',
      'STATUS:COMPLETED',
      'BEGIN:VALARM',
      'SUMMARY:Erinnerung',
      'END:VALARM',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n');
    const task = parseIcalTodo(ics)!;
    expect(task).toMatchObject({ uid: 'abc', summary: 'Sommerreifen wechseln', completed: true, due: '2026-11-14', description: null });
    const patch = taskPatch(row, 'todo', task, (t) => parseItem(t, undefined, 'todo'));
    expect(patch).toMatchObject({ name: 'Sommerreifen wechseln', checked: true, note: null });
    expect(patch.attributes).toMatchObject({ due: '2026-11-14' });
    expect(patch.attributes).not.toHaveProperty('url');
    // A shopping title with amount is read like typed input.
    const milk = { ...row, name: 'Milch', note: null, attributes: {} };
    expect(taskTitle({ ...milk, amounts: [{ q: 1, u: 'l' }] }, 'shopping')).toBe('Milch – 1 l');
    expect(
      taskPatch(
        { ...milk, amounts: [{ q: 1, u: 'l' }] },
        'shopping',
        { summary: '2 l Milch', description: null, completed: false, due: null, url: null },
        (t) => parseItem(t),
      ),
    ).toEqual({ amounts: [{ q: 2, u: 'l' }] });
  });
});

describe('status of open entries', () => {
  const list = { settings: { statuses: [{ id: 'a', name: 'Neu' }, { id: 'b', name: 'In Arbeit' }, { id: 'b', name: 'doppelt' }, { name: 'kaputt' }] } };
  it('reads the list statuses and an item status, first one by default', () => {
    const statuses = listStatuses(list);
    expect(statuses.map((s) => s.name)).toEqual(['Neu', 'In Arbeit']);
    expect(itemStatus({ attributes: {} }, statuses)?.name).toBe('Neu');
    expect(itemStatus({ attributes: { status: 'b' } }, statuses)?.name).toBe('In Arbeit');
    // A status removed from the list: back to the first.
    expect(itemStatus({ attributes: { status: 'x' } }, statuses)?.name).toBe('Neu');
    expect(itemStatus({ attributes: { status: 'b' } }, [])).toBeNull();
    expect(withStatus({ status: 'b' }, 'a', statuses)).toEqual({});
    expect(withStatus({}, 'b', statuses)).toEqual({ status: 'b' });
    expect(findStatus(statuses, 'in arbeit')?.id).toBe('b');
    // A default of its own: new entries (no status stored) have it.
    const withDefault = { settings: { ...list.settings, defaultStatus: 'b' } };
    const def = listDefaultStatus(withDefault);
    expect(def?.name).toBe('In Arbeit');
    expect(itemStatus({ attributes: {} }, statuses, def)?.name).toBe('In Arbeit');
    expect(withStatus({}, 'a', statuses, def)).toEqual({ status: 'a' });
    expect(listDefaultStatus({ settings: { ...list.settings, defaultStatus: 'gone' } })?.name).toBe('Neu');
  });
});
