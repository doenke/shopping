/**
 * Image generators behind one interface (docs/konzept/10-icons-plan.md):
 * switching the provider is configuration, not code.
 *
 * - Cloudflare Workers AI, FLUX.2 [klein]: daily free allocation, up to 4 style references.
 * - OpenAI gpt-image: paid, native transparency, used as fallback ("mit Bezahl-Modell").
 */

export interface GenerateRequest {
  prompt: string;
  /** Style references (PNG), already prepared for the provider's background. */
  references: Buffer[];
  seed: number;
}

export interface IconGenerator {
  provider: 'cloudflare' | 'openai';
  model: string;
  paid: boolean;
  maxReferences: number;
  /** Background the generator is asked for: the key colour, or real transparency. */
  background: 'key' | 'transparent';
  /** Estimated cost per image in thousandths (0.1 cent). */
  costMilli: number;
  generate(req: GenerateRequest): Promise<Buffer>;
}

/** The provider's quota is used up: try again after `until`. */
export class QuotaExceeded extends Error {
  constructor(
    message: string,
    readonly until: Date,
  ) {
    super(message);
  }
}

export function nextUtcMidnight(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5));
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text) as { errors?: { message?: string }[]; error?: { message?: string } };
    return j.errors?.map((e) => e.message).join('; ') || j.error?.message || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

// ---- Cloudflare Workers AI ---------------------------------------------------

export const CLOUDFLARE_MODELS = ['flux-2-klein-4b', 'flux-2-klein-9b', 'flux-2-dev'] as const;
const CLOUDFLARE_TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export interface CloudflareOptions {
  accountId: string;
  token: string;
  model: string;
  size: number;
  fetchImpl?: typeof fetch;
}

export class CloudflareGenerator implements IconGenerator {
  readonly provider = 'cloudflare' as const;
  readonly paid = false;
  readonly maxReferences = 4;
  readonly background = 'key' as const;
  readonly costMilli = 0;
  readonly model: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: CloudflareOptions) {
    this.model = opts.model;
    this.fetch = opts.fetchImpl ?? fetch;
  }

  private url(model: string): string {
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.opts.accountId)}/ai/run/${model}`;
  }

  private async check(res: Response): Promise<never> {
    const msg = await errorText(res);
    // Free allocation used up (429, or error 4006 "daily free allocation").
    if (res.status === 429 || /allocation|neurons|4006/i.test(msg)) {
      throw new QuotaExceeded(`Cloudflare: Tageskontingent erschöpft (${msg})`, nextUtcMidnight());
    }
    throw new Error(`Cloudflare ${res.status}: ${msg}`);
  }

  async generate({ prompt, references, seed }: GenerateRequest): Promise<Buffer> {
    // FLUX.2 on Workers AI takes multipart form data, references as input_image_0..3.
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('width', String(this.opts.size));
    form.append('height', String(this.opts.size));
    form.append('seed', String(seed));
    references.slice(0, this.maxReferences).forEach((ref, i) => {
      form.append(`input_image_${i}`, new Blob([new Uint8Array(ref)], { type: 'image/png' }), `ref${i}.png`);
    });
    const res = await this.fetch(this.url(`@cf/black-forest-labs/${this.model}`), {
      method: 'POST',
      headers: { authorization: `Bearer ${this.opts.token}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) await this.check(res);
    const body = (await res.json()) as { result?: { image?: string }; success?: boolean };
    if (!body.result?.image) throw new Error('Cloudflare: keine Bilddaten in der Antwort');
    return Buffer.from(body.result.image, 'base64');
  }

  /** Asks a small text model how to draw a German grocery item (used when the catalog has no description). */
  async describe(name: string, category: string): Promise<string> {
    const res = await this.fetch(this.url(CLOUDFLARE_TEXT_MODEL), {
      method: 'POST',
      headers: { authorization: `Bearer ${this.opts.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content:
              'You write the subject line for a grocery icon. Answer with one short English noun phrase only, no quotes, no style words. ' +
              'Say what is shown and how many, e.g. "group of three potatoes", "plain white carton of milk with a small blue band, three-quarter view", ' +
              '"single roll of toilet paper". Packaged goods are generic, without brands or text.',
          },
          { role: 'user', content: `German item: "${name}" (category: ${category})` },
        ],
        max_tokens: 60,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) await this.check(res);
    const body = (await res.json()) as { result?: { response?: string } };
    const text = body.result?.response?.trim().replace(/^["'„]|["'“]$/g, '').split('\n')[0]?.trim();
    if (!text) throw new Error('Cloudflare: keine Beschreibung erhalten');
    return text.slice(0, 200);
  }
}

// ---- OpenAI --------------------------------------------------------------------

export const OPENAI_MODELS = ['gpt-image-1-mini', 'gpt-image-1', 'gpt-image-1.5'] as const;
export const OPENAI_QUALITIES = ['low', 'medium', 'high'] as const;

/** Rough list prices for a 1024² image, in thousandths. Only used for the cost cap. */
const OPENAI_COST: Record<string, Record<string, number>> = {
  'gpt-image-1-mini': { low: 5, medium: 11, high: 36 },
  'gpt-image-1': { low: 11, medium: 42, high: 167 },
  'gpt-image-1.5': { low: 9, medium: 34, high: 133 },
};

export interface OpenAiOptions {
  apiKey: string;
  model: string;
  quality: string;
  fetchImpl?: typeof fetch;
}

export class OpenAiGenerator implements IconGenerator {
  readonly provider = 'openai' as const;
  readonly paid = true;
  readonly maxReferences = 4;
  readonly background = 'transparent' as const;
  readonly model: string;
  readonly costMilli: number;
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: OpenAiOptions) {
    this.model = opts.model;
    this.costMilli = OPENAI_COST[opts.model]?.[opts.quality] ?? 50;
    this.fetch = opts.fetchImpl ?? fetch;
  }

  async generate({ prompt, references }: GenerateRequest): Promise<Buffer> {
    const headers = { authorization: `Bearer ${this.opts.apiKey}` };
    const common = { model: this.model, prompt, size: '1024x1024', quality: this.opts.quality, background: 'transparent', output_format: 'png', n: '1' };
    let res: Response;
    if (references.length) {
      // With style references: the edits endpoint takes several input images.
      const form = new FormData();
      for (const [k, v] of Object.entries(common)) form.append(k, v);
      references.slice(0, this.maxReferences).forEach((ref, i) => {
        form.append('image[]', new Blob([new Uint8Array(ref)], { type: 'image/png' }), `ref${i}.png`);
      });
      res = await this.fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers, body: form, signal: AbortSignal.timeout(180_000) });
    } else {
      res = await this.fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ...common, n: 1 }),
        signal: AbortSignal.timeout(180_000),
      });
    }
    if (!res.ok) {
      const msg = await errorText(res);
      if (res.status === 429 && !/quota|billing/i.test(msg)) {
        throw new QuotaExceeded(`OpenAI: zu viele Anfragen (${msg})`, new Date(Date.now() + 15 * 60_000));
      }
      throw new Error(`OpenAI ${res.status}: ${msg}`);
    }
    const body = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI: keine Bilddaten in der Antwort');
    return Buffer.from(b64, 'base64');
  }
}
