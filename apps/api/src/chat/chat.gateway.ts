import type { Server as HttpServer } from 'node:http';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { Server, type Namespace, type Socket } from 'socket.io';
import { SessionService } from '../auth/session.service';
import type { Env } from '../config/env';
import { ENV, LOGGER, VALKEY } from '../core/tokens';
import { DispatchService } from '../notifications/dispatch.service';
import { SchedulerService } from '../worker/scheduler.service';
import { ChatService, type ChatRole, type CloseReason } from './chat.service';

/** Same-origin path, so /v1 routing (Next rewrite locally, Caddy in production) covers it. */
export const CHAT_PATH = '/v1/socket.io';
const room = (alertId: string) => `alert:${alertId}`;

interface SocketData {
  role: ChatRole;
  alertId: string;
  lang: 'de' | 'en';
}

/** Per-connection token bucket: Socket events are rate-limited (messages and typing separately). */
class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
  ) {
    this.tokens = capacity;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.last) / 1000) * this.perSecond,
    );
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/**
 * Socket.io namespace /chat. Scanner: alert id + chat token (from the URL fragment) in the handshake
 * `auth` payload, never in the query string. Owner (app): alert id + session token, and only for their
 * own vehicle. One room per alert. The Valkey adapter shares events between API instances (prepared for
 * more than one server); PostgreSQL stays the source of truth (ChatService).
 */
@Injectable()
export class ChatGateway implements OnModuleDestroy {
  private io: Server | null = null;
  private nsp: Namespace | null = null;
  private pubSub: Redis[] = [];

  constructor(
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(DispatchService) private readonly dispatch: DispatchService,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(ENV) private readonly env: Env,
  ) {}

  attach(server: HttpServer): void {
    if (this.io) return;
    this.io = new Server(server, {
      path: CHAT_PATH,
      // No trailing slash (/v1/socket.io?EIO=…): Next.js would answer /v1/socket.io/ with a redirect.
      addTrailingSlash: false,
      serveClient: false,
      // Same origin only (the scanner page); the native app is not a browser and sends no Origin.
      cors: { origin: false },
      maxHttpBufferSize: 8_192,
      pingInterval: 20_000,
      pingTimeout: 20_000,
    });
    const pub = this.valkey.duplicate();
    const sub = this.valkey.duplicate();
    this.pubSub = [pub, sub];
    this.io.adapter(createAdapter(pub, sub, { key: 'ps:chat' }));
    const nsp = this.io.of('/chat');
    this.nsp = nsp;

    nsp.use((socket, next) => {
      this.authenticate(socket)
        .then((data) => {
          if (!data) return next(new Error('unauthorized'));
          socket.data = data;
          next();
        })
        .catch(() => next(new Error('unauthorized')));
    });
    nsp.on('connection', (socket) => void this.onConnection(socket));

    // Timeouts: 20 min without a message, 3 h after opening. A Valkey lock keeps it to one instance.
    if (!this.env.CHAT_SWEEP_MS) return;
    this.scheduler.every({
      name: 'chat.timeouts',
      everyMs: this.env.CHAT_SWEEP_MS,
      quiet: true,
      run: async () => {
        const closed = await this.chat.sweep();
        for (const c of closed) this.closed(c.alertId, c.reason);
        return closed.length;
      },
    });
  }

  private async authenticate(socket: Socket): Promise<SocketData | null> {
    const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
    const alertId = typeof auth.alertId === 'string' ? auth.alertId : '';
    if (auth.role === 'scanner' && typeof auth.token === 'string') {
      if (!(await this.chat.verifyScanner(alertId, auth.token))) return null;
      const lang = auth.lang === 'en' ? 'en' : 'de';
      return { role: 'scanner', alertId, lang };
    }
    if (auth.role === 'owner' && typeof auth.session === 'string') {
      const user = await this.sessions.resolve(auth.session);
      const owner = user ? await this.chat.ownerOf(alertId) : null;
      if (!user || !owner || owner.ownerId !== user.userId) return null;
      return { role: 'owner', alertId, lang: user.preferredLang };
    }
    return null;
  }

  private async onConnection(socket: Socket) {
    const data = socket.data as SocketData;
    const { alertId, role } = data;
    await socket.join(room(alertId));
    const messages = new Bucket(5, 0.5);
    const typing = new Bucket(4, 1);
    let heartbeat: NodeJS.Timeout | null = null;

    if (role === 'scanner') {
      await this.chat.scannerSeen(alertId, true);
      socket.to(room(alertId)).emit('chat:presence', { online: true, lastSeenAt: new Date() });
      heartbeat = setInterval(() => void this.chat.scannerSeen(alertId, true), 20_000);
    }
    socket.emit('chat:state', {
      ...(await this.chat.state(alertId, role)),
      role,
      ...(role === 'owner' ? { quickReplies: await this.chat.quickReplies(data.lang) } : {}),
    });

    socket.on('chat:message', async (payload: unknown, ack?: (r: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      if (!messages.take()) {
        socket.emit('chat:error', { error: 'rate_limited' });
        return reply({ ok: false, error: 'rate_limited' });
      }
      const text =
        payload &&
        typeof payload === 'object' &&
        typeof (payload as { text?: unknown }).text === 'string'
          ? (payload as { text: string }).text.slice(0, 2_000)
          : '';
      try {
        const r = await this.chat.send(alertId, role, text);
        if (!r.ok) {
          socket.emit('chat:error', { error: r.error });
          return reply(r);
        }
        this.nsp?.to(room(alertId)).emit('chat:message', r.message);
        reply({ ok: true, id: r.message.id });
        if (role === 'scanner' && !(await this.ownerConnected(alertId))) {
          // The owner's app is closed or in the background: a push without the text (FCM is Google).
          await this.dispatch
            .chatMessage(alertId)
            .catch((err: unknown) => this.logger.warn({ err: String(err) }, 'chat push failed'));
        }
      } catch (err) {
        this.logger.warn({ err: String(err) }, 'chat message failed');
        socket.emit('chat:error', { error: 'failed' });
        reply({ ok: false, error: 'failed' });
      }
    });

    socket.on('chat:typing', (payload: unknown) => {
      if (!typing.take()) return;
      const on = Boolean(
        payload && typeof payload === 'object' && (payload as { typing?: unknown }).typing,
      );
      socket.to(room(alertId)).emit('chat:typing', { from: role, typing: on });
    });

    socket.on('chat:seen', async () => {
      if (!typing.take()) return;
      const at = await this.chat.markRead(alertId, role);
      socket.to(room(alertId)).emit('chat:seen', { by: role, at });
    });

    socket.on('disconnect', async () => {
      if (heartbeat) clearInterval(heartbeat);
      if (role !== 'scanner') return;
      const others = (await this.nsp?.in(room(alertId)).fetchSockets()) ?? [];
      if (others.some((s) => (s.data as SocketData).role === 'scanner')) return;
      await this.chat.scannerGone(alertId);
      this.nsp?.to(room(alertId)).emit('chat:presence', { online: false, lastSeenAt: new Date() });
    });
  }

  private async ownerConnected(alertId: string): Promise<boolean> {
    const sockets = (await this.nsp?.in(room(alertId)).fetchSockets()) ?? [];
    return sockets.some((s) => (s.data as SocketData).role === 'owner');
  }

  /** The owner opened the chat (REST): the scanner's page switches from waiting to the chat. */
  opened(alertId: string, state: unknown): void {
    this.nsp?.to(room(alertId)).emit('chat:opened', state);
  }

  closed(alertId: string, reason: CloseReason): void {
    this.nsp?.to(room(alertId)).emit('chat:closed', { reason });
  }

  /** The alert changed (seen, acknowledged, escalated): the scanner's status updates live. */
  alertChanged(alertId: string): void {
    this.nsp?.to(room(alertId)).emit('alert:changed', {});
  }

  async onModuleDestroy() {
    // Not io.close(): that would also close the HTTP server, which Fastify owns and closes itself.
    if (this.io) {
      this.io.disconnectSockets(true);
      this.io.engine.close();
      this.io = null;
    }
    for (const c of this.pubSub) c.disconnect();
  }
}
