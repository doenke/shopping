import { comparePositions } from '@shopping/shared';
import { dueOf, itemUrl, lastModified, taskTitle, taskUid, type IncomingTask, type ItemRow, type ListRow } from '@shopping/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorContext } from '../api/service.js';
import { credentialPrincipal, type Principal } from '../auth/principal.js';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { users } from '../db/schema.js';
import type { TaskService } from '../tasks/service.js';

/**
 * JMAP (RFC 8620) with JMAP for Tasks (draft-ietf-jmap-tasks): lists as TaskList, entries as Task
 * (JSCalendar). Session at /.well-known/jmap, API at /jmap/api; log-in with an API token (Bearer or Basic).
 */

const CORE = 'urn:ietf:params:jmap:core';
const TASKS = 'urn:ietf:params:jmap:tasks';

type Args = Record<string, unknown>;
type Invocation = [string, Args, string];

class MethodError extends Error {
  constructor(
    readonly type: string,
    readonly description?: string,
  ) {
    super(type);
  }
}

const Request = z.object({
  using: z.array(z.string()),
  methodCalls: z.array(z.tuple([z.string(), z.record(z.string(), z.unknown()), z.string()])).max(50),
});

/** JSON pointer with "*" over arrays (RFC 8620 3.7). */
function evaluate(value: unknown, path: string): unknown {
  if (path === '' || path === '/') return value;
  const [head, ...rest] = path.replace(/^\//, '').split('/');
  const token = head!.replace(/~1/g, '/').replace(/~0/g, '~');
  const tail = rest.length ? `/${rest.join('/')}` : '';
  if (token === '*' && Array.isArray(value))
    return value.flatMap((v) => (Array.isArray(evaluate(v, tail)) ? (evaluate(v, tail) as unknown[]) : [evaluate(v, tail)]));
  if (value && typeof value === 'object') return evaluate((value as Record<string, unknown>)[token], tail);
  throw new MethodError('invalidResultReference');
}

export async function jmapRoutes(app: FastifyInstance, opts: { config: Config; db: Db; tasks: TaskService }) {
  const { config, db, tasks } = opts;

  const auth = async (request: FastifyRequest, reply: FastifyReply): Promise<Principal | null> => {
    const principal = await credentialPrincipal(db, request.headers.authorization);
    if (!principal) {
      reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer realm="Shopping", Basic realm="Shopping"')
        .send({ type: 'about:blank', status: 401, detail: 'API-Token fehlt' });
      return null;
    }
    return principal;
  };

  app.get('/.well-known/jmap', async (request, reply) => {
    const principal = await auth(request, reply);
    if (!principal) return reply;
    const [u] = await db.select({ name: users.displayName, email: users.email }).from(users).where(eq(users.id, principal.userId));
    const lists = await tasks.lists(principal.userId);
    return {
      capabilities: {
        [CORE]: {
          maxSizeUpload: 0,
          maxConcurrentUpload: 1,
          maxSizeRequest: 1_000_000,
          maxConcurrentRequests: 4,
          maxCallsInRequest: 50,
          maxObjectsInGet: 1000,
          maxObjectsInSet: 500,
          collationAlgorithms: ['i;unicode-casemap'],
        },
        [TASKS]: {},
      },
      accounts: {
        [principal.userId]: {
          name: u?.name ?? 'Shopping',
          isPersonal: true,
          isReadOnly: !principal.scopes.has('write'),
          accountCapabilities: { [TASKS]: { shouldSupportScheduling: false, mayCreateTaskList: false } },
        },
      },
      primaryAccounts: { [TASKS]: principal.userId },
      username: u?.email ?? u?.name ?? principal.userId,
      apiUrl: `${config.PUBLIC_URL}/jmap/api`,
      downloadUrl: `${config.PUBLIC_URL}/jmap/download/{accountId}/{blobId}/{name}?type={type}`,
      uploadUrl: `${config.PUBLIC_URL}/jmap/upload/{accountId}/`,
      eventSourceUrl: `${config.PUBLIC_URL}/jmap/events?types={types}&closeafter={closeafter}&ping={ping}`,
      state: String(await tasks.state(lists.map((l) => l.id))),
    };
  });

  app.post('/jmap/api', async (request, reply) => {
    const principal = await auth(request, reply);
    if (!principal) return reply;
    const parsed = Request.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ type: 'urn:ietf:params:jmap:error:notRequest', status: 400, detail: parsed.error.message });
    const unknown = parsed.data.using.filter((c) => c !== CORE && c !== TASKS);
    if (unknown.length) return reply.code(400).send({ type: 'urn:ietf:params:jmap:error:unknownCapability', status: 400, detail: unknown.join(', ') });

    const responses: Invocation[] = [];
    const created = new Map<string, string>();
    await actorContext.run({ via: principal.tokenName ?? 'Aufgaben-App' }, async () => {
      for (const [name, rawArgs, callId] of parsed.data.methodCalls as Invocation[]) {
        try {
          const args = resolveReferences(rawArgs, responses);
          if (args.accountId !== undefined && args.accountId !== principal.userId) throw new MethodError('accountNotFound');
          const result = await call(principal, name, args, created);
          responses.push([name, { accountId: principal.userId, ...result }, callId]);
        } catch (err) {
          if (err instanceof MethodError) responses.push(['error', { type: err.type, ...(err.description ? { description: err.description } : {}) }, callId]);
          else {
            request.log.error(err);
            responses.push(['error', { type: 'serverFail' }, callId]);
          }
        }
      }
    });
    const lists = await tasks.lists(principal.userId);
    return {
      methodResponses: responses,
      sessionState: String(await tasks.state(lists.map((l) => l.id))),
      ...(created.size ? { createdIds: Object.fromEntries(created) } : {}),
    };
  });

  function resolveReferences(args: Args, previous: Invocation[]): Args {
    const out: Args = {};
    for (const [k, v] of Object.entries(args)) {
      if (!k.startsWith('#')) {
        out[k] = v;
        continue;
      }
      const ref = v as { resultOf: string; name: string; path: string };
      const source = previous.find(([n, , id]) => id === ref.resultOf && n === ref.name);
      if (!source) throw new MethodError('invalidResultReference');
      out[k.slice(1)] = evaluate(source[1], ref.path);
    }
    return out;
  }

  // ---- objects --------------------------------------------------------------

  const ids = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null);

  function taskList(l: ListRow, position: number) {
    return {
      id: l.id,
      name: l.name,
      description: typeof l.settings.description === 'string' ? l.settings.description : null,
      color: l.color,
      role: null,
      sortOrder: position,
      isSubscribed: true,
      myRights: { mayReadItems: true, mayWriteAll: true, mayWriteOwn: true, mayUpdatePrivate: true, mayRSVP: false, mayAdmin: false, mayDelete: false },
      'shopping:type': l.listType,
    };
  }

  function task(i: ItemRow, l: ListRow) {
    const due = dueOf(i);
    const url = itemUrl(i);
    const container = typeof i.attributes.container === 'string' ? i.attributes.container : null;
    return {
      id: i.id,
      '@type': 'Task',
      uid: taskUid(i),
      taskListId: l.id,
      title: taskTitle(i, l.listType),
      description: i.note ?? '',
      due: due ? `${due}T00:00:00` : null,
      showWithoutTime: true,
      progress: i.checked ? 'completed' : 'needs-action',
      progressUpdated: i.checkedAt ?? lastModified(i).toISOString(),
      created: i.createdAt,
      updated: lastModified(i).toISOString(),
      keywords: container ? { [container]: true } : {},
      links: url ? { url: { '@type': 'Link', href: url } } : {},
      'shopping:name': i.name,
    };
  }

  /** What a JMAP Task (or a patch to it) says, merged into the current values. */
  function incoming(current: Partial<IncomingTask>, input: Args): IncomingTask {
    const t: IncomingTask = { uid: null, summary: '', description: null, completed: false, due: null, url: null, ...current };
    for (const [k, v] of Object.entries(input)) {
      if (k === 'title' && typeof v === 'string') t.summary = v;
      else if (k === 'description') t.description = typeof v === 'string' && v.trim() ? v : null;
      else if (k === 'due') t.due = typeof v === 'string' ? v.slice(0, 10) : null;
      else if (k === 'progress') t.completed = v === 'completed';
      else if (k === 'uid' && typeof v === 'string') t.uid = v;
      else if (k === 'links') {
        const first = v && typeof v === 'object' ? Object.values(v as Record<string, { href?: unknown }>)[0] : undefined;
        t.url = typeof first?.href === 'string' ? first.href : null;
      } else if (k.startsWith('links/')) {
        const link = v as { href?: unknown } | null;
        t.url = link && typeof link.href === 'string' ? link.href : null;
      }
    }
    return t;
  }

  // ---- methods --------------------------------------------------------------

  async function call(principal: Principal, name: string, args: Args, created: Map<string, string>): Promise<Args> {
    const userId = principal.userId;
    const write = () => {
      if (!principal.scopes.has('write')) throw new MethodError('forbidden', 'Dem Token fehlt die Berechtigung „write“');
    };
    const lists = await tasks.lists(userId);
    const listIds = lists.map((l) => l.id);
    const byList = new Map(lists.map((l) => [l.id, l]));

    switch (name) {
      case 'Core/echo':
        return args;

      case 'TaskList/get': {
        const want = ids(args.ids);
        const state = String(await tasks.state(listIds));
        const list = lists.map(taskList).filter((l) => !want || want.includes(l.id));
        return { state, list, notFound: want ? want.filter((id) => !byList.has(id)) : [] };
      }

      case 'TaskList/changes': {
        const state = await tasks.state(listIds);
        const since = Number(args.sinceState);
        if (!Number.isFinite(since)) throw new MethodError('cannotCalculateChanges');
        const updated = lists.filter((l) => l.seq > since).map((l) => l.id);
        return { oldState: String(args.sinceState), newState: String(state), hasMoreChanges: false, created: [], updated, destroyed: [] };
      }

      case 'Task/get': {
        const want = ids(args.ids);
        const items = await tasks.items(listIds);
        const found = items.filter((i) => !want || want.includes(i.id));
        return {
          state: String(await tasks.state(listIds)),
          list: found.map((i) => task(i, byList.get(i.listId)!)),
          notFound: want ? want.filter((id) => !items.some((i) => i.id === id)) : [],
        };
      }

      case 'Task/query': {
        const filter = (args.filter ?? {}) as { inTaskList?: string; completed?: boolean; text?: string; title?: string };
        let items = await tasks.items(filter.inTaskList ? listIds.filter((id) => id === filter.inTaskList) : listIds);
        if (filter.completed !== undefined) items = items.filter((i) => i.checked === filter.completed);
        const text = (filter.text ?? filter.title)?.toLowerCase();
        if (text) items = items.filter((i) => i.name.toLowerCase().includes(text) || (i.note ?? '').toLowerCase().includes(text));
        // Lists in the user's order, entries in list order.
        items.sort((a, b) => listIds.indexOf(a.listId) - listIds.indexOf(b.listId) || comparePositions(a.position, b.position));
        const position = Math.max(0, Number(args.position ?? 0));
        const limit = args.limit === undefined || args.limit === null ? undefined : Number(args.limit);
        const page = items.slice(position, limit === undefined ? undefined : position + limit);
        return {
          queryState: String(await tasks.state(listIds)),
          canCalculateChanges: false,
          position,
          ids: page.map((i) => i.id),
          ...(args.calculateTotal ? { total: items.length } : {}),
        };
      }

      case 'Task/changes': {
        const since = Number(args.sinceState);
        if (!Number.isFinite(since)) throw new MethodError('cannotCalculateChanges');
        const changed = await tasks.items(listIds, since);
        return {
          oldState: String(args.sinceState),
          newState: String(await tasks.state(listIds)),
          hasMoreChanges: false,
          created: [],
          updated: changed.filter((i) => !i.deleted).map((i) => i.id),
          destroyed: changed.filter((i) => i.deleted).map((i) => i.id),
        };
      }

      case 'Task/set': {
        const oldState = String(await tasks.state(listIds));
        if (args.ifInState !== undefined && args.ifInState !== null && args.ifInState !== oldState) throw new MethodError('stateMismatch');
        const result: Args = { oldState, created: {}, updated: {}, destroyed: [], notCreated: {}, notUpdated: {}, notDestroyed: {} };
        const createdOut = result.created as Args;
        const notCreated = result.notCreated as Args;
        const updatedOut = result.updated as Args;
        const notUpdated = result.notUpdated as Args;
        const destroyed = result.destroyed as string[];
        const notDestroyed = result.notDestroyed as Args;

        for (const [cid, raw] of Object.entries((args.create ?? {}) as Record<string, Args>)) {
          write();
          const list = byList.get(String(raw.taskListId ?? ''));
          if (!list) {
            notCreated[cid] = { type: 'invalidProperties', properties: ['taskListId'] };
            continue;
          }
          if (typeof raw.title !== 'string' || !raw.title.trim()) {
            notCreated[cid] = { type: 'invalidProperties', properties: ['title'] };
            continue;
          }
          const id = await tasks.create(userId, list, incoming({}, raw));
          created.set(cid, id);
          const item = await tasks.byId(id);
          createdOut[cid] = item ? { id, uid: taskUid(item) } : { id };
        }

        for (const [id, patch] of Object.entries((args.update ?? {}) as Record<string, Args>)) {
          write();
          const item = await tasks.byId(created.get(id.replace(/^#/, '')) ?? id);
          const list = item ? byList.get(item.listId) : undefined;
          if (!item || !list) {
            notUpdated[id] = { type: 'notFound' };
            continue;
          }
          const current: IncomingTask = {
            uid: taskUid(item),
            summary: taskTitle(item, list.listType),
            description: item.note,
            completed: item.checked,
            due: dueOf(item),
            url: itemUrl(item),
          };
          await tasks.update(userId, list, item, incoming(current, patch));
          updatedOut[id] = null;
        }

        for (const id of ids(args.destroy) ?? []) {
          write();
          const item = await tasks.byId(id);
          if (!item || !byList.has(item.listId)) {
            notDestroyed[id] = { type: 'notFound' };
            continue;
          }
          await tasks.remove(userId, item);
          destroyed.push(id);
        }
        result.newState = String(await tasks.state(listIds));
        return result;
      }

      default:
        throw new MethodError('unknownMethod', name);
    }
  }
}
