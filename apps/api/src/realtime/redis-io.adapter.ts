import { Logger, type INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@ruletka/shared-types';

import { buildRedisOptions } from '../redis/redis.module';

/**
 * Strongly-typed Socket.io server using the shared event maps. Feature gateways
 * should declare their server/socket with these same generics so emit/listen
 * payloads are checked against the contract.
 */
export type AppIoServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/**
 * Custom Nest WebSocket adapter that plugs the `@socket.io/redis-adapter` into
 * every Socket.io server Nest creates, enabling horizontal scaling: events
 * (and `Server`-level broadcasts / room joins) propagate across all API
 * instances over Redis pub/sub.
 *
 * Wiring: a dedicated `pub` connection plus a `sub` connection (its
 * `.duplicate()` — Redis requires a separate connection for subscriber mode)
 * built from the SAME settings as the app's primary client. These are distinct
 * from `REDIS_CLIENT` and from BullMQ's connection on purpose.
 *
 * ── Base gateway pattern (for the mm / rtc / chat gateway agents) ─────────────
 * Feature gateways should be typed against the shared maps and rely on this
 * adapter for cross-node delivery — never instantiate Redis themselves:
 *
 * ```ts
 * import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
 * import type { Socket } from 'socket.io';
 * import type { AppIoServer } from '../realtime/redis-io.adapter';
 * import type { ClientToServerEvents, ServerToClientEvents, SocketData }
 *   from '@ruletka/shared-types';
 *
 * @WebSocketGateway({ namespace: '/mm' })
 * export class MatchmakingGateway {
 *   @WebSocketServer() server!: AppIoServer;
 *
 *   // socket is typed with the client→server map + SocketData
 *   handleConnection(client: Socket<ClientToServerEvents, ServerToClientEvents,
 *     never, SocketData>) {
 *     // client.data.userId is set by an auth middleware (feature agent owns it)
 *   }
 * }
 * ```
 * Broadcasting `this.server.to(roomId).emit('mm:matched', payload)` is then
 * delivered to peers connected to ANY instance via the Redis adapter.
 *
 * CORS for the WS layer is configured here from `CORS_ORIGINS` so the handshake
 * succeeds from the web app's origin with credentials.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(
    private readonly app: INestApplicationContext,
    private readonly config: ConfigService,
  ) {
    super(app);
  }

  /**
   * Establishes the pub/sub connections and builds the adapter factory. Call
   * from `main.ts` BEFORE `app.listen()` (it is async — connecting eagerly here
   * surfaces Redis problems at boot rather than on first socket).
   */
  async connectToRedis(): Promise<void> {
    const options = buildRedisOptions(this.config);
    this.pubClient = new Redis(options);
    this.subClient = this.pubClient.duplicate();

    this.pubClient.on('error', (err: Error) =>
      this.logger.error(`Socket.io pub client error: ${err.message}`),
    );
    this.subClient.on('error', (err: Error) =>
      this.logger.error(`Socket.io sub client error: ${err.message}`),
    );

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
    this.logger.log('Socket.io Redis adapter connected (horizontal scaling enabled)');
  }

  /** Closes both adapter connections during graceful shutdown. */
  override async close(): Promise<void> {
    await Promise.allSettled([this.pubClient?.quit(), this.subClient?.quit()]);
  }

  /**
   * Creates each Socket.io server with CORS configured and, once connected, the
   * Redis adapter attached. Nest calls this for the root server and every
   * namespaced gateway.
   */
  override createIOServer(port: number, options?: ServerOptions): AppIoServer {
    const corsOrigins = (this.config.get<string>('CORS_ORIGINS') ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);

    // Mirror the HTTP CORS policy (see main.ts): `credentials: true` must NEVER
    // pair with a reflect-any-origin policy. With an explicit allow-list we use
    // it; with an EMPTY list we fail CLOSED in production (origin:false — no
    // cross-origin socket handshake) rather than reflecting any origin with
    // credentials, and only reflect (origin:true) outside production for local
    // dev convenience.
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    let origin: string[] | boolean;
    if (corsOrigins.length > 0) {
      origin = corsOrigins;
    } else if (isProd) {
      this.logger.warn(
        'CORS_ORIGINS is empty in production; cross-origin socket access is disabled. ' +
          'Set CORS_ORIGINS to the web app origin(s) to enable the browser client.',
      );
      origin = false;
    } else {
      origin = true;
    }

    const server: AppIoServer = super.createIOServer(port, {
      ...options,
      cors: {
        origin,
        credentials: true,
      },
    });

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
