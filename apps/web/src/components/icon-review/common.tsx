import { getCategory } from '@shopping/shared';
import { useCustomCategories } from '../../categories';

export interface Checks {
  background?: boolean;
  complete?: boolean;
  size?: boolean;
}

export interface Candidate {
  id: string;
  checks: Checks;
  aiReview: { ok: boolean; shows: string; reason: string } | null;
  provider: string;
  model: string;
}

export type ProviderId = 'cloudflare' | 'openai' | 'claude';

export const PROVIDER_LABEL: Record<ProviderId, string> = { cloudflare: 'FLUX', openai: 'OpenAI', claude: 'Claude (SVG)' };

export interface ReviewTarget {
  targetType: 'item' | 'category';
  targetId: string;
  name: string;
  categoryId: string;
  subject: string | null;
  approved: string | null;
  candidates: Candidate[];
}

export interface GalleryIcon {
  id: string;
  targetType: 'item' | 'category';
  targetId: string;
  name: string;
  categoryId: string;
  subject: string | null;
  isAnchor: boolean;
}

export interface Status {
  settings: {
    enabled: boolean;
    autoApprove: boolean;
    provider: ProviderId;
    candidates: number;
    style: string;
    cloudflare: { accountId: string | null; hasToken: boolean; model: string; dailyLimit: number; size: number };
    openai: { hasKey: boolean; model: string; quality: string; monthlyCap: number };
    anthropic: { hasKey: boolean; svgModel: string; review: boolean; categorize: boolean; fallback: boolean; reviewModel: string; monthlyCap: number };
    pausedUntil: string | null;
    pauseReason: string | null;
  };
  phase: 'style' | 'mass';
  anchors: number;
  minAnchors: number;
  items: number;
  withIcon: number;
  categoriesWithIcon: number;
  candidates: number;
  queued: number;
  failed: { id: string; targetType: string; targetId: string; name: string; error: string | null }[];
  usage: { cloudflareToday: number; openaiMonth: number; claudeMonth: number };
  running: boolean;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Only send a JSON content type with a body – Fastify rejects an empty JSON body.
  const headers = init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers;
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { detail?: string; error?: string };
    throw new Error(b.detail ?? b.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const post = <T,>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const CHECK_TEXT: Record<keyof Checks, string> = {
  background: 'Hintergrund nicht sauber entfernt',
  complete: 'Motiv angeschnitten',
  size: 'Motiv sehr klein',
};

export function euro(amount: number): string {
  return amount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

/** Providers that are set up, for "mit … neu erzeugen". */
export function readyProviders(s: Status['settings']): ProviderId[] {
  return [
    ...(s.cloudflare.hasToken && s.cloudflare.accountId ? (['cloudflare'] as const) : []),
    ...(s.openai.hasKey ? (['openai'] as const) : []),
    ...(s.anthropic.hasKey ? (['claude'] as const) : []),
  ];
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** The candidate as the app shows it: on the light and dark tile, at 96, 48 and 32 px. */
export function Preview({ src, categoryId }: { src: string; categoryId: string }) {
  const color = getCategory(categoryId, useCustomCategories()).color;
  return (
    <div className="icon-preview">
      {(['light', 'dark'] as const).map((mode) => (
        <div key={mode} className={`icon-preview__row icon-preview__row--${mode}`} style={{ '--cat': color } as React.CSSProperties}>
          {[96, 48, 32].map((px) => (
            <span key={px} className="icon-preview__tile" style={{ width: px + 12, height: px + 12 }}>
              <img src={src} alt="" width={px} height={px} />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
