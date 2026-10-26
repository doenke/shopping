import { normalize } from '@shopping/shared';

/**
 * Spices and dried herbs are hard to draw recognisably – they all get the same little pile of
 * powder, only coloured differently. Drawn here, no image AI involved.
 */
const SPICE_COLORS: Record<string, string> = {
  salz: '#E4E2DA',
  meersalz: '#E4E2DA',
  pfeffer: '#3B3632',
  'schwarzer pfeffer': '#3B3632',
  pfefferkoerner: '#3B3632',
  'weisser pfeffer': '#D9CDB4',
  paprika: '#C8372D',
  paprikapulver: '#C8372D',
  'paprika edelsuess': '#C8372D',
  'paprika rosenscharf': '#B3261E',
  'geraeuchertes paprikapulver': '#A0302A',
  chili: '#B3261E',
  chilipulver: '#B3261E',
  chiliflocken: '#B3261E',
  cayennepfeffer: '#B3261E',
  'pul biber': '#B03A22',
  curry: '#E0A526',
  currypulver: '#E0A526',
  kurkuma: '#E8A317',
  zimt: '#8B5A2B',
  muskat: '#9C6B3E',
  muskatnuss: '#9C6B3E',
  kreuzkuemmel: '#8F6A3A',
  cumin: '#8F6A3A',
  kuemmel: '#6F5A3A',
  koriander: '#A88B5A',
  ingwerpulver: '#D9B36C',
  knoblauchpulver: '#E8DCC0',
  knoblauchgranulat: '#E8DCC0',
  zwiebelpulver: '#E3D2A8',
  oregano: '#6B7F3A',
  thymian: '#6E7D4A',
  rosmarin: '#5F7350',
  majoran: '#7A8A50',
  basilikum: '#4F7A35',
  'kraeuter der provence': '#6E7A48',
  'italienische kraeuter': '#6A7A40',
  'garam masala': '#8A5A35',
  'ras el hanout': '#A5602F',
  zatar: '#7A7A45',
  sumach: '#8E2B3A',
  piment: '#6B4A33',
  nelken: '#5A3A28',
  gewuerznelken: '#5A3A28',
  kardamom: '#9AA06A',
  sternanis: '#6B3E2A',
  fenchelsamen: '#A8A060',
  anis: '#A89A6A',
  bockshornklee: '#C9A04A',
  senfsaat: '#C9A23A',
  lebkuchengewuerz: '#8A5530',
  spekulatiusgewuerz: '#8A5530',
};

const SKIP = new Set(['gemahlen', 'getrocknet', 'getrocknete', 'getrockneter', 'ganz', 'pulver']);

/** Colour of a known spice (by name or alias), or undefined. */
export function knownSpiceColor(names: (string | null | undefined)[]): string | undefined {
  for (const n of names) {
    if (!n) continue;
    const key = normalize(n);
    const plain = key
      .split(' ')
      .filter((w) => !SKIP.has(w))
      .join(' ');
    const hit = SPICE_COLORS[key] ?? SPICE_COLORS[plain];
    if (hit) return hit;
  }
  return undefined;
}

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(factor < 1 ? c * factor : c + (255 - c) * (factor - 1));
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${((1 << 24) | (r! << 16) | (g! << 8) | b!).toString(16).slice(1)}`;
}

/** Always the same pile (fixed pseudo-random dots), lit from the top left. */
const DOTS = (() => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const dots: { x: number; y: number; r: number; t: number }[] = [];
  const cx = 256;
  const base = 380;
  const a = 175;
  const b = 165;
  while (dots.length < 230) {
    const x = (rnd() * 2 - 1) * a;
    const y = rnd() * b;
    if ((x * x) / (a * a) + (y * y) / (b * b) > 1) continue;
    // t: 0 = shadow side (bottom right), 1 = light (top left)
    const t = Math.min(1, Math.max(0, 0.55 + (y / b) * 0.45 - (x / a) * 0.35 + (rnd() - 0.5) * 0.3));
    dots.push({ x: cx + x, y: base - y, r: 9 + rnd() * 7, t });
  }
  // A few grains that rolled off.
  for (const [x, y] of [
    [70, 392],
    [96, 402],
    [430, 396],
    [452, 388],
    [405, 408],
  ] as const)
    dots.push({ x, y, r: 7, t: 0.4 });
  return dots.sort((p, q) => q.y - p.y);
})();

export function spicePileSvg(color: string): string {
  const dark = shade(color, 0.72);
  const light = shade(color, 1.35);
  const fill = (t: number) => (t < 0.35 ? dark : t > 0.78 ? light : color);
  const dots = DOTS.map((d) => `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${d.r.toFixed(1)}" fill="${fill(d.t)}"/>`).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<ellipse cx="256" cy="398" rx="200" ry="26" fill="#000" opacity="0.12"/>` +
    `<path d="M81 380 A175 165 0 0 1 431 380 Z" fill="${color}"/>` +
    dots +
    `</svg>`
  );
}
