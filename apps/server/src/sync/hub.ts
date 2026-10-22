import type { ServerMessage } from '@shopping/shared';
import { ClientMessageSchema } from '@shopping/shared/schemas';
import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import type { SyncService } from './service.js';

/** What a connection needs from its transport (WebSocket for apps, SSE for integrations). */
interface Transport {
  send(msg: ServerMessage): void;
  isOpen(): boolean;
  /** Keep-alive; returns false if the peer did not answer the previous one. */
  ping(): boolean;
  close(): void;
}

interface Connection {
  transport: Transport;
  userId: string;
  /** Last sequence delivered; -1 until the client said hello. */
  cursor: number;
  /** Serializes deliveries per connection so deltas arrive in order. */
  chain: Promise<void>;
}

export class SyncHub {
  private readonly byUser = new Map<string, Set<Connection>>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    private readonly sync: SyncService,
    private readonly log: FastifyBaseLogger,
  ) {
    // Drop connections that stopped answering (typical for flaky mobile networks).
    this.heartbeat = setInterval(() => {
      for (const set of this.byUser.values()) for (const c of set) if (!c.transport.ping()) c.transport.close();
    }, 25_000);
    this.heartbeat.unref();
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const set of this.byUser.values()) for (const c of set) c.transport.close();
  }

  private register(userId: string, transport: Transport, cursor: number): Connection {
    const conn: Connection = { transport, userId, cursor, chain: Promise.resolve() };
    let set = this.byUser.get(userId);
    if (!set) this.byUser.set(userId, (set = new Set()));
    set.add(conn);
    return conn;
  }

  private unregister(conn: Connection): void {
    const set = this.byUser.get(conn.userId);
    set?.delete(conn);
    if (set?.size === 0) this.byUser.delete(conn.userId);
  }

  /** The app's WebSocket: speaks the full sync protocol (hello, push, ping). */
  attach(socket: WebSocket, userId: string): void {
    let alive = true;
    const conn = this.register(
      userId,
      {
        send: (msg) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(msg)),
        isOpen: () => socket.readyState === socket.OPEN,
        ping: () => {
          if (!alive) return false;
          alive = false;
          socket.ping();
          return true;
        },
        close: () => socket.terminate(),
      },
      -1,
    );

    socket.on('pong', () => (alive = true));
    socket.on('close', () => this.unregister(conn));
    socket.on('message', (data) => {
      alive = true;
      let msg;
      try {
        msg = ClientMessageSchema.parse(JSON.parse(String(data)));
      } catch {
        socket.close(1008, 'invalid message');
        return;
      }
      switch (msg.t) {
        case 'ping':
          conn.transport.send({ t: 'pong' });
          break;
        case 'hello':
          conn.cursor = msg.since;
          this.deliver(conn, true);
          break;
        case 'push':
          this.sync
            .apply(userId, msg.mutations)
            .then((result) => {
              conn.transport.send({ t: 'ack', mids: result.acked, rejected: result.rejected });
              this.notify(result.affectedUsers);
            })
            .catch((err) => {
              this.log.error({ err }, 'push failed');
              socket.close(1011, 'server error');
            });
          break;
      }
    });
  }

  /**
   * A one-way stream (SSE) for integrations like Home Assistant: receives every
   * change after `since` as a `changes` message. Returns a function to detach.
   */
  attachStream(userId: string, since: number, transport: Transport): () => void {
    const conn = this.register(userId, transport, since);
    return () => this.unregister(conn);
  }

  /** Sends pending deltas to every connected device of the given users. */
  notify(userIds: Iterable<string>): void {
    for (const id of userIds) for (const conn of this.byUser.get(id) ?? []) this.deliver(conn);
  }

  private readonly catalogListeners = new Set<() => void>();

  /** Called whenever the shared catalog changed (e.g. to drop caches). */
  onCatalogChange(fn: () => void): void {
    this.catalogListeners.add(fn);
  }

  broadcast(msg: ServerMessage): void {
    if (msg.t === 'catalog') for (const fn of this.catalogListeners) fn();
    for (const set of this.byUser.values()) for (const conn of set) conn.transport.send(msg);
  }

  private deliver(conn: Connection, force = false): void {
    conn.chain = conn.chain.then(async () => {
      if (conn.cursor < 0 || !conn.transport.isOpen()) return;
      try {
        const changes = await this.sync.pull(conn.userId, conn.cursor);
        const empty = changes.lists.length + changes.items.length + changes.removedLists.length === 0 && !changes.me;
        if (empty && !force) return;
        conn.cursor = changes.seq;
        conn.transport.send({ t: 'changes', ...changes });
      } catch (err) {
        this.log.error({ err }, 'delivering changes failed');
      }
    });
  }
}
