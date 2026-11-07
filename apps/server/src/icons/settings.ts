import { sql } from 'drizzle-orm';
import type { ReviewVerdict } from './anthropic.js';
import type { ProviderId } from './generators.js';
import { DEFAULT_STYLE } from './prompt.js';

/** Below this many anchors the style is still being found: only the anchor items are generated. */
export const MIN_ANCHORS = 4;
export const TICK_MS = 5 * 60_000;
export const CHANGE_DELAY_MS = 3_000;
/** Lists whose free-text entries get their own picture (Merklisten always do). */
export const FREE_LIST = sql`l.list_type IN ('shopping', 'packing')`;

export interface IconSettings {
  /** Works through the queue on its own (daily budget permitting). */
  enabled: boolean;
  /** Approve the first candidate that passes all checks right away, no manual review. */
  autoApprove: boolean;
  provider: ProviderId;
  candidates: number;
  style: string;
  cloudflare: { accountId: string | null; token: string | null; model: string; dailyLimit: number; size: number };
  /** monthlyCap in € (or $) – stops paid generation for the rest of the month. */
  openai: { apiKey: string | null; model: string; quality: string; monthlyCap: number };
  /** Claude: draws SVG icons, pre-reviews pictures, describes items. One cap for all three. */
  anthropic: { apiKey: string | null; svgModel: string; review: boolean; categorize: boolean; fallback: boolean; reviewModel: string; monthlyCap: number };
  pausedUntil: string | null;
  pauseReason: string | null;
}

export const DEFAULTS: IconSettings = {
  enabled: false,
  autoApprove: true,
  provider: 'cloudflare',
  candidates: 2,
  style: DEFAULT_STYLE,
  cloudflare: { accountId: null, token: null, model: 'flux-2-klein-4b', dailyLimit: 150, size: 512 },
  openai: { apiKey: null, model: 'gpt-image-1-mini', quality: 'medium', monthlyCap: 10 },
  anthropic: { apiKey: null, svgModel: 'claude-sonnet-5-5', review: true, categorize: true, fallback: true, reviewModel: 'claude-haiku-5-5', monthlyCap: 10 },
  pausedUntil: null,
  pauseReason: null,
};

export type SettingsUpdate = Partial<Omit<IconSettings, 'cloudflare' | 'openai' | 'anthropic' | 'pausedUntil' | 'pauseReason'>> & {
  cloudflare?: Partial<IconSettings['cloudflare']>;
  openai?: Partial<IconSettings['openai']>;
  anthropic?: Partial<IconSettings['anthropic']>;
};

export const PROVIDER_NAMES: Record<ProviderId, string> = { cloudflare: 'Cloudflare', openai: 'OpenAI', claude: 'Claude' };

export type RunResult = 'idle' | 'done' | 'paused' | 'budget' | 'failed' | 'unconfigured';

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Good enough to go live without a person: all technical checks, and the AI pre-review if there was one. */
export function passesChecks(checks: Record<string, boolean>, aiReview: ReviewVerdict | null): boolean {
  return Object.values(checks).every(Boolean) && (aiReview === null || aiReview.ok);
}

/** Version token in icon URLs: a new approved icon gets a new URL, so caches never serve an old one. */
export function iconToken(iconId: string): string {
  return iconId.replace(/-/g, '').slice(0, 10);
}
