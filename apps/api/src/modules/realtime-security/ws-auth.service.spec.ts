import { Types } from 'mongoose';

import { WsAuthService } from './ws-auth.service';
import { USER_DISCONNECT_CHANNEL } from './realtime-security.constants';

/** A structurally-valid JwtPayload (matches the runtime jwtPayloadSchema). */
const VALID_PAYLOAD = {
  sub: '507f1f77bcf86cd799439011',
  role: 'user' as const,
  isPremium: false,
};

describe('WsAuthService', () => {
  let jwtService: { verify: jest.Mock };
  let usersFindOne: jest.Mock;
  let connection: { collection: jest.Mock };
  let redis: { duplicate: jest.Mock };
  let subscriber: {
    on: jest.Mock;
    subscribe: jest.Mock;
    quit: jest.Mock;
    emitMessage: (channel: string, message: string) => void;
  };

  function buildSubscriber() {
    let messageHandler: ((channel: string, message: string) => void) | undefined;
    const sub = {
      on: jest.fn().mockImplementation((event: string, cb: (...args: never[]) => void) => {
        if (event === 'message') {
          messageHandler = cb as (channel: string, message: string) => void;
        }
        return sub;
      }),
      subscribe: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
      emitMessage: (channel: string, message: string) => messageHandler?.(channel, message),
    };
    return sub;
  }

  function build(): WsAuthService {
    return new WsAuthService(redis as never, jwtService as never, connection as never);
  }

  beforeEach(() => {
    jwtService = { verify: jest.fn() };
    usersFindOne = jest.fn();
    connection = { collection: jest.fn().mockReturnValue({ findOne: usersFindOne }) };
    subscriber = buildSubscriber();
    redis = { duplicate: jest.fn().mockReturnValue(subscriber) };
  });

  describe('verifyToken — HS256 pin + Zod shape validation', () => {
    it('returns null for a missing token without calling verify', () => {
      const svc = build();
      expect(svc.verifyToken(null)).toBeNull();
      expect(svc.verifyToken(undefined)).toBeNull();
      expect(svc.verifyToken('')).toBeNull();
      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it('pins the algorithm to HS256 on the verify call', () => {
      jwtService.verify.mockReturnValue(VALID_PAYLOAD);
      const svc = build();

      svc.verifyToken('a.b.c');

      expect(jwtService.verify).toHaveBeenCalledWith('a.b.c', { algorithms: ['HS256'] });
    });

    it('returns null when verification throws (bad signature / alg / expiry)', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });
      const svc = build();

      expect(svc.verifyToken('a.b.c')).toBeNull();
    });

    it('rejects a verified-but-malformed payload (Zod safeParse fails)', () => {
      // Right signature, wrong shape (sub is not a 24-hex id; role missing).
      jwtService.verify.mockReturnValue({ sub: 'nope', foo: 1 });
      const svc = build();

      expect(svc.verifyToken('a.b.c')).toBeNull();
    });

    it('returns the typed payload for a valid token', () => {
      jwtService.verify.mockReturnValue(VALID_PAYLOAD);
      const svc = build();

      expect(svc.verifyToken('a.b.c')).toEqual(VALID_PAYLOAD);
    });
  });

  describe('isBanned — on-connect re-check', () => {
    it('treats an invalid id as banned (cannot map to a valid account)', async () => {
      const svc = build();
      await expect(svc.isBanned('not-an-id')).resolves.toBe(true);
      expect(usersFindOne).not.toHaveBeenCalled();
    });

    it('treats a missing user as banned', async () => {
      usersFindOne.mockResolvedValue(null);
      const svc = build();

      await expect(svc.isBanned(VALID_PAYLOAD.sub)).resolves.toBe(true);
    });

    it('returns true for a banned account, false for an active one', async () => {
      const svc = build();

      usersFindOne.mockResolvedValue({
        _id: new Types.ObjectId(VALID_PAYLOAD.sub),
        isBanned: true,
      });
      await expect(svc.isBanned(VALID_PAYLOAD.sub)).resolves.toBe(true);

      usersFindOne.mockResolvedValue({
        _id: new Types.ObjectId(VALID_PAYLOAD.sub),
        isBanned: false,
      });
      await expect(svc.isBanned(VALID_PAYLOAD.sub)).resolves.toBe(false);
    });

    it('fails CLOSED (treats as banned) when the read errors on both the first try AND the retry', async () => {
      usersFindOne.mockRejectedValue(new Error('mongo down'));
      const svc = build();

      // Security gate: an unresolved ban check must DENY the socket.
      await expect(svc.isBanned(VALID_PAYLOAD.sub)).resolves.toBe(true);
      // One first attempt + one retry.
      expect(usersFindOne).toHaveBeenCalledTimes(2);
    });

    it('retries once and RECOVERS when the first read fails but the retry succeeds', async () => {
      usersFindOne
        .mockRejectedValueOnce(new Error('transient blip'))
        .mockResolvedValueOnce({ _id: new Types.ObjectId(VALID_PAYLOAD.sub), isBanned: false });
      const svc = build();

      // The retry sees an active account → not banned.
      await expect(svc.isBanned(VALID_PAYLOAD.sub)).resolves.toBe(false);
      expect(usersFindOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('onDisconnectRequest — ban channel pub/sub', () => {
    it('subscribes to the disconnect channel and fans a published id to handlers', async () => {
      const svc = build();
      const handler = jest.fn();
      svc.onDisconnectRequest(handler);

      // Let the lazy ensureSubscribed() microtask settle.
      await Promise.resolve();
      await Promise.resolve();

      expect(redis.duplicate).toHaveBeenCalledTimes(1);
      expect(subscriber.subscribe).toHaveBeenCalledWith(USER_DISCONNECT_CHANNEL);

      // A message on the channel invokes the handler with the trimmed id.
      subscriber.emitMessage(USER_DISCONNECT_CHANNEL, `  ${VALID_PAYLOAD.sub}  `);
      expect(handler).toHaveBeenCalledWith(VALID_PAYLOAD.sub);
    });

    it('ignores messages on other channels and empty payloads', async () => {
      const svc = build();
      const handler = jest.fn();
      svc.onDisconnectRequest(handler);
      await Promise.resolve();
      await Promise.resolve();

      subscriber.emitMessage('some:other:channel', VALID_PAYLOAD.sub);
      subscriber.emitMessage(USER_DISCONNECT_CHANNEL, '   ');

      expect(handler).not.toHaveBeenCalled();
    });

    it('stops invoking a handler after it unsubscribes', async () => {
      const svc = build();
      const handler = jest.fn();
      const off = svc.onDisconnectRequest(handler);
      await Promise.resolve();
      await Promise.resolve();

      off();
      subscriber.emitMessage(USER_DISCONNECT_CHANNEL, VALID_PAYLOAD.sub);

      expect(handler).not.toHaveBeenCalled();
    });

    it('opens only ONE subscriber connection across multiple handlers', async () => {
      const svc = build();
      svc.onDisconnectRequest(jest.fn());
      svc.onDisconnectRequest(jest.fn());
      await Promise.resolve();
      await Promise.resolve();

      expect(redis.duplicate).toHaveBeenCalledTimes(1);
    });
  });
});
