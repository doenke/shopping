import { MAX_FILE_SIZE } from '@shopping/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../api/errors.js';
import { credentialPrincipal } from '../auth/principal.js';
import type { Db } from '../db/index.js';
import type { FileService } from './service.js';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** Shown in the browser (pictures, PDFs, text); anything else is downloaded. */
const INLINE = /^(image\/(jpeg|png|gif|webp|avif)|application\/pdf|text\/plain)$/i;

function disposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * PUT /api/v1/files/:id – the raw file as body, `?name=` its name, Content-Type its type.
 * GET /api/v1/files/:id[?thumb=1][&download=1] – the file (or the preview of a picture).
 */
export async function fileRoutes(app: FastifyInstance, opts: { files: FileService; db: Db; requireUser: Guard }) {
  app.register(async (scope) => {
    // Task apps (CalDAV ATTACH) fetch files with the API token as Basic password, like the calendar itself.
    scope.addHook('preHandler', async (request, reply) => {
      if (!request.headers.authorization?.startsWith('Basic ')) return opts.requireUser(request, reply);
      const principal = await credentialPrincipal(opts.db, request.headers.authorization);
      if (!principal?.scopes.has(request.method === 'GET' ? 'read' : 'write')) {
        reply.header('WWW-Authenticate', 'Basic realm="Shopping", charset="UTF-8"');
        throw new ApiError(401, 'unauthorized', 'Bitte mit einem API-Token als Passwort anmelden');
      }
      request.principal = principal;
      request.userId = principal.userId;
      request.isGuest = principal.isGuest;
    });
    // Every body is the file itself, also JSON or text.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: MAX_FILE_SIZE }, (_req, body, done) => done(null, body));

    scope.put('/api/v1/files/:id', { bodyLimit: MAX_FILE_SIZE }, async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { name } = z.object({ name: z.string().max(500).default('Datei') }).parse(request.query);
      const data = request.body;
      if (!Buffer.isBuffer(data) || data.length === 0) throw new ApiError(400, 'empty', 'Keine Datei mitgeschickt');
      const mime = (request.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase().slice(0, 100);
      const result = await opts.files.put(request.userId, id, { name, mime, size: data.length, data });
      if (result === 'conflict') throw new ApiError(409, 'conflict', 'Diese Datei-ID ist schon vergeben');
      return reply.code(result === 'created' ? 201 : 200).send({ id, size: data.length });
    });

    scope.get('/api/v1/files/:id', async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const q = z.object({ thumb: z.string().optional(), download: z.string().optional() }).parse(request.query);
      const file = await opts.files.get(request.userId, id, !!q.thumb);
      if (!file) throw new ApiError(404, 'not_found', 'Datei nicht gefunden');
      // A file never changes under its id.
      reply.header('Cache-Control', 'private, max-age=31536000, immutable');
      reply.header('Content-Type', file.mime);
      reply.header('X-Content-Type-Options', 'nosniff');
      // Nothing uploaded runs as a page of this site.
      reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
      reply.header('Content-Disposition', disposition(INLINE.test(file.mime) && !q.download ? 'inline' : 'attachment', file.name));
      return reply.send(file.data);
    });
  });
}
