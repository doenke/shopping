/** Known item properties. Key: lowercase input form, value: canonical display form. */
const KNOWN: Record<string, string> = {
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

export const SUGGESTED_PROPERTIES = ['bio', 'TK', 'vegan', 'laktosefrei', 'glutenfrei', 'fettarm', 'groß', 'klein', 'reif', 'regional', 'Angebot'];

export function findProperty(token: string): string | undefined {
  return KNOWN[token.toLowerCase()];
}
