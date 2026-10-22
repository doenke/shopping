export interface CategoryDef {
  id: string;
  name: string;
  color: string;
  order: number;
}

/** The categories as known from Bring!. */
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

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string | null | undefined): CategoryDef {
  return byId.get(id ?? DEFAULT_CATEGORY) ?? byId.get(DEFAULT_CATEGORY)!;
}
