/**
 * Order of entries by their position keys (fractional indexing). Plain code-unit comparison: the keys use
 * upper- and lower-case letters ("Zz" comes before "a0"), which a locale-aware compare would mix up.
 */
export function comparePositions(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
