export interface CategoryDef {
  id: string;
  name: string;
  color: string;
  order: number;
}

/** Grocery categories, roughly in the order of a supermarket. */
export const CATEGORIES: CategoryDef[] = [
  { id: 'obst-gemuese', name: 'Obst & Gemüse', color: '#5BAA45', order: 10 },
  { id: 'brot-gebaeck', name: 'Brot & Gebäck', color: '#C98A3E', order: 20 },
  { id: 'milch-kaese', name: 'Milch & Käse', color: '#E3B505', order: 30 },
  { id: 'fleisch-fisch', name: 'Fleisch & Fisch', color: '#D2544B', order: 40 },
  { id: 'zutaten-gewuerze', name: 'Zutaten & Gewürze', color: '#B5651D', order: 50 },
  { id: 'fertig-tk', name: 'Fertig- & Tiefkühlprodukte', color: '#4A90C9', order: 60 },
  { id: 'getreide', name: 'Getreideprodukte', color: '#D8A94E', order: 70 },
  { id: 'snacks-suesses', name: 'Snacks & Süßwaren', color: '#C2569A', order: 80 },
  { id: 'getraenke', name: 'Getränke & Tabak', color: '#3FA7A0', order: 90 },
  { id: 'haushalt', name: 'Haushalt & Gesundheit', color: '#7A7FD1', order: 100 },
  { id: 'pflege', name: 'Pflege & Gesundheit', color: '#9B6FC4', order: 110 },
  { id: 'tierbedarf', name: 'Tierbedarf', color: '#8C6D4F', order: 120 },
  { id: 'baumarkt-garten', name: 'Baumarkt & Garten', color: '#6B8E3D', order: 130 },
  { id: 'eigene', name: 'Eigene Artikel', color: '#8A8F98', order: 140 },
];

export const DEFAULT_CATEGORY = 'eigene';

/** Categories of packing lists (list type "packing"). */
export const PACKING_CATEGORIES: CategoryDef[] = [
  { id: 'dokumente', name: 'Dokumente & Geld', color: '#4A90C9', order: 10 },
  { id: 'kleidung', name: 'Kleidung', color: '#C2569A', order: 20 },
  { id: 'schuhe', name: 'Schuhe', color: '#8C6D4F', order: 30 },
  { id: 'koerperpflege', name: 'Körperpflege', color: '#9B6FC4', order: 40 },
  { id: 'reiseapotheke', name: 'Reiseapotheke', color: '#D2544B', order: 50 },
  { id: 'technik', name: 'Technik', color: '#7A7FD1', order: 60 },
  { id: 'unterwegs', name: 'Unterwegs & Proviant', color: '#C98A3E', order: 70 },
  { id: 'freizeit', name: 'Freizeit & Sport', color: '#3FA7A0', order: 80 },
  { id: 'kinder', name: 'Kinder', color: '#E3B505', order: 90 },
  { id: 'ausruestung', name: 'Ausrüstung', color: '#6B8E3D', order: 100 },
  { id: 'packen-sonstiges', name: 'Sonstiges', color: '#8A8F98', order: 110 },
];

export const DEFAULT_PACKING_CATEGORY = 'packen-sonstiges';

/** Merklisten (films, books, restaurants …) have no categories of their own – one group. */
export const MEMO_CATEGORIES: CategoryDef[] = [{ id: 'merkliste', name: 'Merkliste', color: '#5C7CBA', order: 10 }];

/** ToDo lists: tasks have no categories either. */
export const TODO_CATEGORIES: CategoryDef[] = [{ id: 'aufgaben', name: 'Aufgaben', color: '#4F8A8B', order: 10 }];

/** All categories of all list types (ids are unique across types). */
export const ALL_CATEGORIES: CategoryDef[] = [...CATEGORIES, ...PACKING_CATEGORIES, ...MEMO_CATEGORIES, ...TODO_CATEGORIES];

const byId = new Map(ALL_CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string | null | undefined): CategoryDef {
  return byId.get(id ?? DEFAULT_CATEGORY) ?? byId.get(DEFAULT_CATEGORY)!;
}

export function categoriesFor(listType: string): CategoryDef[] {
  return listType === 'packing' ? PACKING_CATEGORIES : listType === 'memo' ? MEMO_CATEGORIES : listType === 'todo' ? TODO_CATEGORIES : CATEGORIES;
}

export function defaultCategoryFor(listType: string): string {
  return listType === 'packing' ? DEFAULT_PACKING_CATEGORY : listType === 'memo' ? 'merkliste' : listType === 'todo' ? 'aufgaben' : DEFAULT_CATEGORY;
}

/** Category of an item shown in a list of the given type (unknown/other-type ones go to "Sonstiges"). */
export function categoryInList(id: string | null | undefined, listType: string): CategoryDef {
  const own = categoriesFor(listType);
  return own.find((c) => c.id === id) ?? getCategory(defaultCategoryFor(listType));
}
