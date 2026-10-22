import { ClientMessageSchema, type ServerMessage } from '@shopping/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import type { SyncService } from './service.js';

interface Connection {
  socket: WebSocket;
  userId: string;
  /** Last sequence delivered to this socket; -1 until the client said hello. */
  cursor: number;
  /** Serializes deliveries per socket so deltas arrive in order. */
  chain: Promise<void>;
  alive: boolean;
}

export class SyncHub {
  private readonly byUser = new Map<string, Set<Connection>>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    private readonly sync: SyncService,
    private readonly log: FastifyBaseLogger,
  ) {
    // Drop sockets that stopped answering (typical for flaky mobile networks).
    this.heartbeat = setInterval(() => {
      for (const set of this.byUser.values()) {
        for (const c of set) {
          if (!c.alive) {
            c.socket.terminate();
            continue;
          }
          c.alive = false;
          c.socket.ping();
        }
      }
    }, 30_000);
    this.heartbeat.unref();
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const set of this.byUser.values()) for (const c of set) c.socket.close(1001);
  }

  attach(socket: WebSocket, userId: string): void {
    const conn: Connection = { socket, userId, cursor: -1, chain: Promise.resolve(), alive: true };
    let set = this.byUser.get(userId);
    if (!set) this.byUser.set(userId, (set = new Set()));
    set.add(conn);

    socket.on('pong', () => (conn.alive = true));
    socket.on('close', () => {
      set.delete(conn);
      if (set.size === 0) this.byUser.delete(userId);
    });
    socket.on('message', (data) => {
      conn.alive = true;
      let msg;
      try {
        msg = ClientMessageSchema.parse(JSON.parse(String(data)));
      } catch {
        socket.close(1008, 'invalid message');
        return;
      }
      switch (msg.t) {
        case 'ping':
          this.send(conn, { t: 'pong' });
          break;
        case 'hello':
          conn.cursor = msg.since;
          this.deliver(conn, true);
          break;
        case 'push':
          this.sync
            .apply(userId, msg.mutations)
            .then((result) => {
              this.send(conn, { t: 'ack', mids: result.acked, rejected: result.rejected });
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

  /** Sends pending deltas to every connected device of the given users. */
  notify(userIds: Iterable<string>): void {
    for (const id of userIds) for (const conn of this.byUser.get(id) ?? []) this.deliver(conn);
  }

  broadcast(msg: ServerMessage): void {
    for (const set of this.byUser.values()) for (const conn of set) this.send(conn, msg);
  }

  private deliver(conn: Connection, force = false): void {
    conn.chain = conn.chain.then(async () => {
      if (conn.cursor < 0 || conn.socket.readyState !== conn.socket.OPEN) return;
      try {
        const changes = await this.sync.pull(conn.userId, conn.cursor);
        const empty = changes.lists.length + changes.items.length + changes.removedLists.length === 0 && !changes.me;
        if (empty && !force) return;
        conn.cursor = changes.seq;
        this.send(conn, { t: 'changes', ...changes });
      } catch (err) {
        this.log.error({ err }, 'delivering changes failed');
      }
    });
  }

  private send(conn: Connection, msg: ServerMessage): void {
    if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(JSON.stringify(msg));
  }
}
