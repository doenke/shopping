import { z } from 'zod';

export interface RouteDoc {
  method: string;
  url: string;
  summary: string;
  description?: string;
  tag: string;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
  stream?: boolean;
}

function schema(s: z.ZodTypeAny, io: 'input' | 'output' = 'input'): Record<string, unknown> {
  return z.toJSONSchema(s, { io, unrepresentable: 'any' }) as Record<string, unknown>;
}

function parameters(s: z.ZodTypeAny | undefined, where: 'path' | 'query') {
  if (!s) return [];
  const json = schema(s) as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, prop]) => ({
    name,
    in: where,
    required: where === 'path' || (json.required ?? []).includes(name),
    description: prop.description,
    schema: prop,
  }));
}

/** OpenAPI 3.1 description, generated from the same zod schemas that validate requests. */
export function buildOpenApi(routes: RouteDoc[], serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const path = r.url.replace(/:(\w+)/g, '{$1}');
    paths[path] ??= {};
    paths[path][r.method.toLowerCase()] = {
      summary: r.summary,
      description: r.description,
      tags: [r.tag],
      parameters: [...parameters(r.params, 'path'), ...parameters(r.query, 'query')],
      ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: schema(r.body) } } } } : {}),
      responses: {
        200: r.stream ? { description: 'Event-Stream', content: { 'text/event-stream': {} } } : { description: 'OK' },
        400: { $ref: '#/components/responses/Problem' },
        401: { $ref: '#/components/responses/Problem' },
        403: { $ref: '#/components/responses/Problem' },
        404: { $ref: '#/components/responses/Problem' },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Shopping API',
      version: '1',
      description:
        'Einkaufslisten lesen und bearbeiten – für Home Assistant, n8n und Skripte. Anmeldung mit einem API-Token aus den Einstellungen der App: `Authorization: Bearer shp_…`. Listen dürfen statt per ID auch per Name oder `default` (Hauptliste) angesprochen werden.',
    },
    servers: [{ url: serverUrl }],
    security: [{ bearer: [] }],
    paths,
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'API-Token (shp_…) oder OAuth-Zugriffstoken' } },
      responses: {
        Problem: {
          description: 'Fehler nach RFC 9457',
          content: {
            'application/problem+json': {
              schema: {
                type: 'object',
                properties: { title: { type: 'string' }, status: { type: 'integer' }, code: { type: 'string' }, detail: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  };
}
