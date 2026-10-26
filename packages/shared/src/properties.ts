import type { ListType } from './model.js';

/** Known grocery properties. Key: lowercase input form, value: canonical display form. */
const SHOPPING: Record<string, string> = {
  bio: 'bio',
  tk: 'TK',
  tiefgekühlt: 'TK',
  gefroren: 'TK',
  vegan: 'vegan',
  vegetarisch: 'vegetarisch',
  laktosefrei: 'laktosefrei',
  glutenfrei: 'glutenfrei',
  zuckerfrei: 'zuckerfrei',
  fettarm: 'fettarm',
  light: 'light',
  frisch: 'frisch',
  groß: 'groß',
  grosse: 'groß',
  große: 'groß',
  großen: 'groß',
  klein: 'klein',
  kleine: 'klein',
  kleinen: 'klein',
  reif: 'reif',
  reife: 'reif',
  gemischt: 'gemischt',
  gehackt: 'gehackt',
  gerieben: 'gerieben',
  geschnitten: 'geschnitten',
  ganz: 'ganz',
  kernlos: 'kernlos',
  ungesalzen: 'ungesalzen',
  gesalzen: 'gesalzen',
  natur: 'natur',
  vollkorn: 'Vollkorn',
  mild: 'mild',
  scharf: 'scharf',
  festkochend: 'festkochend',
  mehligkochend: 'mehligkochend',
  regional: 'regional',
  angebot: 'Angebot',
};

/** Packing: what to remember about a thing on the way. */
const PACKING: Record<string, string> = {
  handgepäck: 'Handgepäck',
  aufladen: 'aufladen',
  laden: 'aufladen',
  kaufen: 'kaufen',
  besorgen: 'kaufen',
  leihen: 'leihen',
  ausleihen: 'leihen',
  zerbrechlich: 'zerbrechlich',
  wichtig: 'wichtig',
  waschen: 'waschen',
};

/** ToDo: urgency and what a task needs. */
const TODO: Record<string, string> = {
  wichtig: 'wichtig',
  dringend: 'dringend',
};

/**
 * Words the input line turns into properties, per list type. Merklisten have none:
 * "Der kleine Prinz" stays a title.
 */
const KNOWN: Record<ListType, Record<string, string>> = { shopping: SHOPPING, packing: PACKING, memo: {}, todo: TODO };

/** The chips offered in the editor, per list type. */
const SUGGESTED: Record<ListType, string[]> = {
  shopping: ['bio', 'TK', 'vegan', 'laktosefrei', 'glutenfrei', 'fettarm', 'groß', 'klein', 'reif', 'regional', 'Angebot'],
  packing: ['Handgepäck', 'zuletzt einpacken', 'aufladen', 'kaufen', 'leihen', 'zerbrechlich', 'wichtig', 'waschen'],
  memo: ['Highlight', 'zu zweit', 'mit Kindern', 'mit Freunden', 'Kino', 'gratis', 'reservieren', 'leihen'],
  todo: ['wichtig', 'dringend', 'schnell erledigt', 'draußen', 'Hilfe nötig', 'Material kaufen', 'wartet'],
};

/** Grocery suggestions (kept for callers that know no list type). */
export const SUGGESTED_PROPERTIES = SUGGESTED.shopping;

export function suggestedProperties(listType: ListType = 'shopping'): string[] {
  return SUGGESTED[listType];
}

export function findProperty(token: string, listType: ListType = 'shopping'): string | undefined {
  return KNOWN[listType][token.toLowerCase()];
}
