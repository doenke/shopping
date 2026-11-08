import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { CatalogItem } from '@shopping/shared';
import { Converter, mergeCandidates, type ImportCandidate } from '../mealie/convert.js';

/** What a recipe page says about itself (schema.org Recipe, as Bring and search engines read it). */
export interface WebRecipe {
  name: string;
  url: string;
  image: string | null;
  /** Servings the ingredient amounts are for, if the page says. */
  servings: number | null;
  ingredients: string[];
}

export class RecipeError extends Error {}

const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/** No requests into the own network: only public hosts (the URL comes from a user). */
function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
    return (
      v === '::1' ||
      v === '::' ||
      v.startsWith('fc') ||
      v.startsWith('fd') ||
      v.startsWith('fe8') ||
      v.startsWith('fe9') ||
      v.startsWith('fea') ||
      v.startsWith('feb')
    );
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new RecipeError('Nur Links mit http(s) gehen');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new RecipeError('Die Seite ist nicht erreichbar');
  if (addresses.some(privateAddress)) throw new RecipeError('Dieser Link zeigt ins eigene Netz');
}

async function fetchPage(input: string, fetchImpl: typeof fetch): Promise<{ html: string; url: string }> {
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);
    const res = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        'accept-language': 'de-DE,de;q=0.9',
      },
    }).catch(() => {
      throw new RecipeError('Die Seite ist nicht erreichbar');
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url);
      continue;
    }
    if (!res.ok) throw new RecipeError(`Die Seite antwortet nicht (${res.status})`);
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) throw new RecipeError('Die Seite ist zu groß');
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new RecipeError('Die Seite ist zu groß');
    return { html: new TextDecoder().decode(buf), url: url.toString() };
  }
  throw new RecipeError('Zu viele Weiterleitungen');
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  egrave: 'è',
  deg: '°',
};

function decode(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRecipe(node: unknown): node is Record<string, unknown> {
  if (!node || typeof node !== 'object') return false;
  const t = (node as Record<string, unknown>)['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
}

/** All JSON-LD blocks of a page; the recipe may sit at the top, in an array or in @graph. */
function findRecipe(html: string): Record<string, unknown> | null {
  const blocks = html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, raw] of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(raw!.trim());
    } catch {
      continue;
    }
    const queue: unknown[] = [data];
    while (queue.length) {
      const node = queue.shift();
      if (Array.isArray(node)) queue.push(...node);
      else if (isRecipe(node)) return node;
      else if (node && typeof node === 'object') {
        const graph = (node as Record<string, unknown>)['@graph'];
        if (graph) queue.push(graph);
        const main = (node as Record<string, unknown>).mainEntity;
        if (main) queue.push(main);
      }
    }
  }
  return null;
}

function yieldOf(v: unknown): number | null {
  const values = Array.isArray(v) ? v : [v];
  for (const x of values) {
    const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(/\d+([.,]\d+)?/.exec(x)?.[0]?.replace(',', '.')) : NaN;
    if (Number.isFinite(n) && n > 0 && n < 100) return n;
  }
  return null;
}

function imageOf(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return imageOf(v[0]);
  if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') return (v as { url: string }).url;
  return null;
}

/** Reads the recipe of a page from its structured data. Throws a RecipeError with a message for people. */
export async function fetchWebRecipe(input: string, fetchImpl: typeof fetch = fetch): Promise<WebRecipe> {
  const { html, url } = await fetchPage(input, fetchImpl);
  const recipe = findRecipe(html);
  if (!recipe) throw new RecipeError('Auf dieser Seite wurde kein Rezept gefunden');
  const raw = (recipe.recipeIngredient ?? recipe.ingredients) as unknown;
  const ingredients = (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [])
    .filter((x): x is string => typeof x === 'string')
    .map(decode)
    .filter(Boolean);
  if (ingredients.length === 0) throw new RecipeError('Das Rezept nennt keine Zutaten');
  return {
    name: decode(typeof recipe.name === 'string' ? recipe.name : 'Rezept'),
    url,
    image: imageOf(recipe.image),
    servings: yieldOf(recipe.recipeYield ?? recipe.yield),
    ingredients,
  };
}

/**
 * Ingredient lines as written on German recipe sites, tidied for the parser:
 * "1 Zwiebel(n)" → "1 Zwiebel", "n. B. Salz" → "Salz", "200 g Mehl (Type 405)" stays.
 */
export function tidyIngredient(line: string): string {
  return line
    .replace(/\((?:n|s|e|en|er|nen)\)/gi, '')
    .replace(/^\s*(?:n\.\s*B\.|nach Belieben|etwas|evtl\.|ggf\.)\s+/i, '')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The recipe's ingredients as import candidates (same shape and rules as a Mealie recipe), scaled to `servings`. */
export async function webRecipeCandidates(
  recipe: WebRecipe,
  catalog: CatalogItem[],
  servings?: number,
): Promise<{ name: string; url: string; image: string | null; servings: number | null; items: ImportCandidate[] }> {
  const scale = servings && recipe.servings ? servings / recipe.servings : 1;
  const converter = new Converter(catalog, {});
  const items = recipe.ingredients
    .map((line) => converter.convert({ quantity: null, unit: null, food: null, note: null }, tidyIngredient(line), { keepNote: true, scale }))
    .filter((c): c is ImportCandidate => !!c)
    .map((c) => ({ ...c, sources: [recipe.name] }));
  return { name: recipe.name, url: recipe.url, image: recipe.image, servings: servings ?? recipe.servings, items: mergeCandidates(items) };
}

/**
 * Title of a web page for a shared or pasted link ("Dune: Part Two | Netflix"): og:title, else <title>.
 * Same safety rules as for recipes (public addresses only, size and time limits).
 */
export async function fetchPageTitle(input: string, fetchImpl: typeof fetch = fetch): Promise<{ title: string | null; url: string }> {
  const { html, url } = await fetchPage(input, fetchImpl);
  const meta =
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html)?.[1] ??
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = meta ? decode(meta).slice(0, 120) : '';
  return { title: title || null, url };
}
