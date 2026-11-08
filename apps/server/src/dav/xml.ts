/**
 * Just enough WebDAV XML for CalDAV clients: which properties a PROPFIND/REPORT asks for, the hrefs
 * and sync token of a REPORT, and multistatus answers. Clients send small, well-formed bodies;
 * names are compared by namespace + local name (prefixes differ from client to client).
 */

export const NS = {
  dav: 'DAV:',
  cal: 'urn:ietf:params:xml:ns:caldav',
  cs: 'http://calendarserver.org/ns/',
  ical: 'http://apple.com/ns/ical/',
} as const;

const PREFIX: Record<string, string> = { [NS.dav]: 'd', [NS.cal]: 'c', [NS.cs]: 'cs', [NS.ical]: 'ic' };

export interface PropName {
  ns: string;
  name: string;
}

export const key = (p: PropName) => `${p.ns}|${p.name}`;

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Namespace declarations of the body (xmlns / xmlns:x), good enough for client requests. */
function namespaces(xml: string): { def: string; byPrefix: Map<string, string> } {
  const byPrefix = new Map<string, string>();
  let def: string = NS.dav;
  for (const m of xml.matchAll(/xmlns(?::([\w.-]+))?\s*=\s*["']([^"']*)["']/g)) {
    if (m[1]) byPrefix.set(m[1], m[2]!);
    else def = m[2]!;
  }
  return { def, byPrefix };
}

function resolve(tag: string, ns: ReturnType<typeof namespaces>): PropName {
  const i = tag.indexOf(':');
  return i < 0 ? { ns: ns.def, name: tag } : { ns: ns.byPrefix.get(tag.slice(0, i)) ?? tag.slice(0, i), name: tag.slice(i + 1) };
}

/** The root element of a request body ("propfind", "calendar-multiget", "sync-collection" …). */
export function rootElement(xml: string): PropName | null {
  const m = /<(?!\?|!)([\w.:-]+)/.exec(xml);
  return m ? resolve(m[1]!, namespaces(xml)) : null;
}

/**
 * The properties asked for: the children of <prop>. `all` for <allprop/> or an empty body (PROPFIND
 * without body means allprop).
 */
export function requestedProps(xml: string): { all: boolean; props: PropName[] } {
  if (!xml.trim() || /<([\w.-]+:)?allprop\b/.test(xml)) return { all: true, props: [] };
  const ns = namespaces(xml);
  const block = /<((?:[\w.-]+:)?prop)\b[^>]*>([\s\S]*?)<\/\1\s*>/.exec(xml);
  if (!block) return { all: true, props: [] };
  const props: PropName[] = [];
  // Top-level children only: skip what is nested (calendar-data may carry <comp> filters).
  let depth = 0;
  for (const m of block[2]!.matchAll(/<(\/?)([\w.:-]+)[^>]*?(\/?)>/g)) {
    const [, close, tag, selfClose] = m;
    if (close) {
      depth--;
      continue;
    }
    if (depth === 0) props.push(resolve(tag!, ns));
    if (!selfClose) depth++;
  }
  return { all: false, props };
}

export function hrefs(xml: string): string[] {
  return [...xml.matchAll(/<(?:[\w.-]+:)?href\b[^>]*>([^<]*)<\//g)].map((m) => unescapeXml(m[1]!.trim()));
}

export function syncToken(xml: string): string {
  return unescapeXml(/<(?:[\w.-]+:)?sync-token\b[^>]*>([^<]*)<\//.exec(xml)?.[1]?.trim() ?? '');
}

/** <d:displayname>…</d:displayname> of a PROPPATCH. */
export function setDisplayName(xml: string): string | null {
  const m = /<(?:[\w.-]+:)?set\b[\s\S]*?<(?:[\w.-]+:)?displayname\b[^>]*>([^<]*)<\//.exec(xml);
  return m ? unescapeXml(m[1]!.trim()) : null;
}

/** An element for a property, with its namespace; `inner` is XML (already escaped). */
export function el(p: PropName, inner?: string): string {
  const prefix = PREFIX[p.ns];
  const tag = prefix ? `${prefix}:${p.name}` : `x:${p.name}`;
  const decl = prefix ? '' : ` xmlns:x="${escapeXml(p.ns)}"`;
  return inner === undefined || inner === '' ? `<${tag}${decl}/>` : `<${tag}${decl}>${inner}</${tag}>`;
}

export interface ResponseEntry {
  href: string;
  /** Found properties (name → inner XML) and missing ones. */
  found?: [PropName, string][];
  missing?: PropName[];
  /** Instead of properties: a status for the whole resource (e.g. 404 for something deleted). */
  status?: number;
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 403: 'Forbidden', 404: 'Not Found' };
const statusLine = (code: number) => `HTTP/1.1 ${code} ${STATUS_TEXT[code] ?? ''}`.trim();

export function multistatus(entries: ResponseEntry[], extra = ''): string {
  const body = entries
    .map((e) => {
      const parts = [`<d:href>${escapeXml(e.href)}</d:href>`];
      if (e.status) parts.push(`<d:status>${statusLine(e.status)}</d:status>`);
      if (e.found?.length) {
        parts.push(`<d:propstat><d:prop>${e.found.map(([p, v]) => el(p, v)).join('')}</d:prop><d:status>${statusLine(200)}</d:status></d:propstat>`);
      }
      if (e.missing?.length) {
        parts.push(`<d:propstat><d:prop>${e.missing.map((p) => el(p)).join('')}</d:prop><d:status>${statusLine(404)}</d:status></d:propstat>`);
      }
      return `<d:response>${parts.join('')}</d:response>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:c="${NS.cal}" xmlns:cs="${NS.cs}" xmlns:ic="${NS.ical}">${body}${extra}</d:multistatus>`;
}
