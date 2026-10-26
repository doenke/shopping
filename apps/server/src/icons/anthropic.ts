import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { QuotaExceeded, type GenerateRequest, type GenerateResult, type IconGenerator } from './generators.js';

/**
 * Claude in the icon pipeline (docs/konzept/10-icons-plan.md):
 * - draws icons as SVG (Sonnet by default) – no image model needed, very consistent style;
 * - pre-reviews generated pictures (Haiku by default) before a person looks at them;
 * - describes Mealie items for the image prompt.
 */

export const CLAUDE_SVG_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'] as const;
export const CLAUDE_REVIEW_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'] as const;

/** List prices in $ per million tokens (input, output). Cache writes cost 1.25×, reads 0.1× the input price. */
const PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
};

/** What a call cost, in millionths of a dollar (= $ per million tokens × tokens). */
export function costMicro(model: string, usage: Anthropic.Beta.BetaUsage): number {
  const [inp, out] = PRICES[model] ?? [4, 20];
  return Math.ceil(
    usage.input_tokens * inp +
      (usage.cache_creation_input_tokens ?? 0) * inp * 1.25 +
      (usage.cache_read_input_tokens ?? 0) * inp * 0.1 +
      usage.output_tokens * out,
  );
}

/** Rough cost of one SVG icon, checked against the monthly cap before a call. */
const SVG_ESTIMATE: Record<string, number> = { 'claude-haiku-5-5': 3_000, 'claude-sonnet-5-5': 40_000, 'claude-opus-5-5': 80_000 };

/** Fallback to another model on a safety decline – only on the larger models (not Haiku). */
function fallbackParams(model: string) {
  return model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[], fallbacks: 'default' as const };
}

export function anthropicClient(apiKey: string, fetchImpl?: typeof fetch): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 180_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

/** Turns rate limits and an empty account into a pause, like the other providers. */
function mapError(err: unknown): never {
  if (err instanceof Anthropic.RateLimitError) throw new QuotaExceeded(`Claude: zu viele Anfragen (${err.message})`, new Date(Date.now() + 15 * 60_000));
  if (err instanceof Anthropic.APIError && err.status === 400 && /credit balance/i.test(err.message)) {
    throw new QuotaExceeded('Claude: Guthaben aufgebraucht', new Date(Date.now() + 24 * 3600_000));
  }
  throw err instanceof Error ? new Error(`Claude: ${err.message}`) : err;
}

function jsonText(msg: Anthropic.Beta.BetaMessage): unknown {
  if (msg.stop_reason === 'refusal') throw new Error('Claude hat die Anfrage abgelehnt');
  if (msg.stop_reason === 'max_tokens') throw new Error('Antwort zu lang (max_tokens)');
  const text = msg.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text;
  if (!text) throw new Error('keine Antwort');
  return JSON.parse(text);
}

const png = (data: Buffer) => ({ type: 'base64' as const, media_type: 'image/png' as const, data: data.toString('base64') });

// ---- SVG drawing ------------------------------------------------------------------

const SVG_SYSTEM = `You draw grocery icons as SVG for a shopping list app. All icons must look like one set.

Canvas and composition:
- <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">, nothing else around it.
- No background: no full-canvas rect, nothing behind the object. Transparent.
- The object is centred and fills about 70-85 % of the 448 x 448 safe area (32 px margin all around). Nothing touches the edge.
- Front view, slightly from above (15-20°); containers in a slight three-quarter view. Long objects diagonal (about 30°).

Style:
- Soft flat illustration: filled shapes only, NO outlines or strokes around shapes (a stroke is allowed only for thin things like a stem).
- Per colour: base tone + one shadow tone + one light tone (+ at most one accent). Light comes from the top left; shadows on the lower right.
- Natural, slightly desaturated colours. No pure white or pure black areas: white things in warm cream (#F3EEE6) with a visible shadow.
- Rounded, friendly, simple shapes with a clear silhouette that reads at 32 px. At most 3-5 detail elements.
- No ground shadow, no glow, no gradients over the whole object (a small radial highlight is fine), no filters, no text or letters, no logos, no faces, no hands, no plates.

Technical:
- Only these elements: svg, g, path, circle, ellipse, rect, polygon, polyline, line, defs, linearGradient, radialGradient, stop, clipPath. Use attributes, no <style> or CSS classes.
- No <text>, <image>, <script>, <foreignObject>, <use>, no external references, no url() except url(#id).
- Keep it compact: at most about 60 elements, short path data with integer coordinates.

Reply with JSON: {"svg": "<svg ...>...</svg>"}.`;

const SVG_SCHEMA = {
  type: 'object',
  properties: { svg: { type: 'string', description: 'The complete SVG document' } },
  required: ['svg'],
  additionalProperties: false,
};

/** Allow-list check before librsvg renders it: no external resources, no scripts, no text. */
export function sanitizeSvg(svg: string): string {
  const s = svg.trim();
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>$/i.test(s)) throw new Error('kein vollständiges SVG');
  if (s.length > 60_000) throw new Error('SVG zu groß');
  const allowed = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'title', 'desc']);
  for (const m of s.matchAll(/<\s*([a-zA-Z][\w:-]*)/g)) {
    if (!allowed.has(m[1]!.toLowerCase())) throw new Error(`unerlaubtes Element <${m[1]}>`);
  }
  if (/(?:xlink:)?href\s*=/i.test(s)) throw new Error('externe Verweise sind nicht erlaubt');
  if (/url\(\s*(?!['"]?#)/i.test(s)) throw new Error('externe url() ist nicht erlaubt');
  if (/<!ENTITY|<!DOCTYPE|<\?xml-stylesheet|\bon\w+\s*=/i.test(s)) throw new Error('unerlaubter Inhalt');
  return s;
}

export async function renderSvg(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 144 }).resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

export interface ClaudeOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export class ClaudeSvgGenerator implements IconGenerator {
  readonly provider = 'claude' as const;
  readonly paid = true;
  readonly maxReferences = 4;
  readonly background = 'transparent' as const;
  readonly model: string;
  readonly costMicro: number;
  private readonly client: Anthropic;

  constructor(opts: ClaudeOptions) {
    this.model = opts.model;
    this.costMicro = SVG_ESTIMATE[opts.model] ?? 80_000;
    this.client = anthropicClient(opts.apiKey, opts.fetchImpl);
  }

  async generate({ subject, style, hint, context, references, referenceSvgs }: GenerateRequest): Promise<GenerateResult> {
    // Style references first and stable (cached across icons), the task last.
    const refs: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (referenceSvgs?.length) {
      refs.push({ type: 'text', text: `Approved icons of the set (SVG source) – match exactly this drawing style:\n\n${referenceSvgs.map((s, i) => `Reference ${i + 1}:\n${s}`).join('\n\n')}` });
    } else if (references.length) {
      refs.push({ type: 'text', text: 'Approved icons of the set (pictures) – match their style, colour treatment and level of detail:' });
      for (const r of references) refs.push({ type: 'image', source: png(r) });
    }
    if (refs.length) refs[refs.length - 1] = { ...refs[refs.length - 1]!, cache_control: { type: 'ephemeral' } } as Anthropic.Beta.BetaContentBlockParam;

    const task = [`Draw: ${subject}.`, context ? `It stands for ${context}.` : null, hint ? `Extra wish: ${hint}.` : null, `Style notes: ${style}`]
      .filter(Boolean)
      .join('\n');
    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: [{ type: 'text', text: SVG_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: [...refs, { type: 'text', text: task }] }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SVG_SCHEMA } },
        ...fallbackParams(this.model),
      });
    } catch (err) {
      mapError(err);
    }
    const cost = costMicro(msg.model, msg.usage);
    const { svg } = jsonText(msg) as { svg: string };
    const clean = sanitizeSvg(svg);
    return { image: await renderSvg(clean), costMicro: cost, svg: clean };
  }
}

// ---- Merkliste entries --------------------------------------------------------------

/** An entry of a Merkliste with what the list is about (films, books, restaurants …). */
export interface EntryContext {
  name: string;
  listName: string;
  description: string | null;
  where: string | null;
  note: string | null;
}

/** One line of context for prompts: what the entry is and what kind of list it is on. */
export function entryContext(e: EntryContext): string {
  return [
    `"${e.name}" on the personal list "${e.listName}"`,
    e.description ? `(the list is about: ${e.description})` : null,
    e.where ? `– available at ${e.where}` : null,
    e.note ? `– note: ${e.note}` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

export const ENTRY_SYSTEM =
  'You write the subject line for an icon that stands for an entry on a personal list (films, series, books, restaurants, places, games, music …). ' +
  'Use the list description to understand what the entry is. Name ONE simple, recognisable object or motif that evokes it: for a film or series a key object or ' +
  'motif from its story (no actors, no faces, no logos, no title text); for a book a closed book whose plain cover shows such a motif; for a restaurant or café a typical ' +
  'dish of its cuisine; for a place a characteristic object of it. One short English noun phrase, no style words, no names of real people, no text.';

export interface ListContext {
  name: string;
  listType: string;
  description: string | null;
}

const LIST_KIND: Record<string, string> = {
  shopping: 'shopping list',
  packing: 'packing list for a trip',
  memo: 'list of things to remember (films, books, restaurants …)',
  todo: 'to-do list',
};

export function listContext(l: ListContext): string {
  return [`"${l.name}" – a ${LIST_KIND[l.listType] ?? 'list'}`, l.description ? `(about: ${l.description})` : null].filter(Boolean).join(' ');
}

export const LIST_SYSTEM =
  'You write the subject line for an icon that stands for a whole personal list in an app; it is shown small next to the list name. ' +
  'The name is German and usually says what the list is for ("Wocheneinkauf", "Baumarkt", "Skiurlaub", "Filme", "Garten"). Name ONE simple, ' +
  'recognisable object or motif that captures it: a shop or occasion by its most typical object (a hardware store: a hammer; a ski trip: skis; ' +
  'films: a film clapperboard; a garden: a watering can; a weekly shop: a paper bag with groceries). If the name is a person or place, pick what the ' +
  'type and description suggest. One short English noun phrase, no style words, no names of real people, no text.';

// ---- pre-review -------------------------------------------------------------------

export interface ReviewVerdict {
  ok: boolean;
  shows: string;
  reason: string;
  model: string;
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    shows: { type: 'string', description: 'What the candidate shows, in a few English words' },
    recognizable: { type: 'boolean', description: 'A shopper would recognise the item at a glance' },
    has_text: { type: 'boolean', description: 'Letters, numbers, labels or logos are visible' },
    style_match: { type: 'boolean', description: 'Fits the reference icons (or the style rules if there are none)' },
    defects: { type: 'boolean', description: 'Cut off, broken shapes, background remnants, several unrelated objects' },
    reason: { type: 'string', description: 'One short German sentence for the person reviewing' },
  },
  required: ['shows', 'recognizable', 'has_text', 'style_match', 'defects', 'reason'],
  additionalProperties: false,
};

export class ClaudeReviewer {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    fetchImpl?: typeof fetch,
  ) {
    this.client = anthropicClient(apiKey, fetchImpl);
  }

  /** Looks at a candidate (on a light tile) next to the style references. */
  async review(candidate: Buffer, item: { name: string; subject: string }, references: Buffer[]): Promise<{ verdict: ReviewVerdict; costMicro: number }> {
    const onTile = (img: Buffer) => sharp(img).resize(256, 256).flatten({ background: '#F4F1EA' }).png().toBuffer();
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (references.length) {
      content.push({ type: 'text', text: 'Approved icons of the set:' });
      for (const r of references) content.push({ type: 'image', source: png(await onTile(r)) });
      content[content.length - 1] = { ...content[content.length - 1]!, cache_control: { type: 'ephemeral' } } as Anthropic.Beta.BetaContentBlockParam;
    }
    content.push(
      { type: 'text', text: `Candidate icon for the shopping list item "${item.name}" (meant to show: ${item.subject}):` },
      { type: 'image', source: png(await onTile(candidate)) },
      {
        type: 'text',
        text: 'Check the candidate for a grocery icon set: soft flat illustration, one object or a small typical group, transparent background, light from top left, no text, no logos. Be strict about recognisability and text, lenient about small style differences.',
      },
    );
    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 2000,
        messages: [{ role: 'user', content }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
        ...fallbackParams(this.model),
      });
    } catch (err) {
      mapError(err);
    }
    const r = jsonText(msg) as { shows: string; recognizable: boolean; has_text: boolean; style_match: boolean; defects: boolean; reason: string };
    return {
      verdict: { ok: r.recognizable && !r.has_text && !r.defects && r.style_match, shows: r.shows, reason: r.reason, model: msg.model },
      costMicro: costMicro(msg.model, msg.usage),
    };
  }

  /** Picture description for a Merkliste entry, from the list's description (a film gets a film motif). */
  async describeEntry(entry: EntryContext): Promise<{ subject: string; costMicro: number }> {
    return this.describeWith(ENTRY_SYSTEM, `Entry: ${entryContext(entry)}`);
  }

  /** Picture description for a whole list, from its name, type and description. */
  async describeList(list: ListContext): Promise<{ subject: string; costMicro: number }> {
    return this.describeWith(LIST_SYSTEM, `List: ${listContext(list)}`);
  }

  private async describeWith(system: string, content: string): Promise<{ subject: string; costMicro: number }> {
    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await this.client.beta.messages.create({
        model: 'claude-haiku-5-5',
        max_tokens: 1000,
        system,
        messages: [{ role: 'user', content }],
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false } },
        },
      });
    } catch (err) {
      mapError(err);
    }
    const { subject } = jsonText(msg) as { subject: string };
    return { subject: subject.trim().slice(0, 200), costMicro: costMicro(msg.model, msg.usage) };
  }

  /** English picture description for a German item (instead of the Cloudflare text model). */
  async describe(name: string, category: string): Promise<{ subject: string; costMicro: number }> {
    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await this.client.beta.messages.create({
        model: 'claude-haiku-5-5',
        max_tokens: 1000,
        system:
          'You write the subject line for a grocery icon. Say what is shown and how many, e.g. "group of three potatoes", ' +
          '"plain white carton of milk with a small blue band, three-quarter view", "single roll of toilet paper". ' +
          'Packaged goods are generic, without brands or text. One short English noun phrase, no style words.',
        messages: [{ role: 'user', content: `German item: "${name}" (category: ${category})` }],
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false } },
        },
      });
    } catch (err) {
      mapError(err);
    }
    const { subject } = jsonText(msg) as { subject: string };
    return { subject: subject.trim().slice(0, 200), costMicro: costMicro(msg.model, msg.usage) };
  }
}
