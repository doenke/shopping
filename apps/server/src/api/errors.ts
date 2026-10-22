import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/** An error with an HTTP status, rendered as RFC 9457 problem+json. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} nicht gefunden`);

const TITLES: Record<number, string> = {
  400: 'Ungültige Anfrage',
  401: 'Nicht angemeldet',
  403: 'Nicht erlaubt',
  404: 'Nicht gefunden',
  409: 'Konflikt',
  500: 'Serverfehler',
};

export function problemHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  let status = 500;
  let code = 'internal';
  let detail = 'Unerwarteter Fehler';
  let extra: Record<string, unknown> = {};
  if (error instanceof ApiError) {
    ({ status, code } = error);
    detail = error.message;
    extra = error.extra;
  } else if (error instanceof ZodError) {
    status = 400;
    code = 'validation';
    detail = error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
  } else if ('statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) {
    status = error.statusCode;
    code = (error as FastifyError).code ?? 'bad_request';
    detail = error.message;
  } else {
    request.log.error({ err: error }, 'request failed');
  }
  return reply
    .code(status)
    .type('application/problem+json')
    .send({ type: 'about:blank', title: TITLES[status] ?? 'Fehler', status, code, detail, ...extra, error: code });
}
