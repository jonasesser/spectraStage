import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  ClientMessageSchema,
  OutputSchema,
  PlaylistSchema,
  PROTOCOL_VERSION,
  StageAmbientSchema,
  SurfaceSchema,
  type ServerMessage,
  type ThemeCatalog,
} from '@spectrastage/shared';
import type { Config } from './config.ts';
import { Store, type TokenRow } from './db.ts';
import { Hub, HubError, type Client } from './hub.ts';
import { clientIp, createLimiter } from './security.ts';

export interface AppContext {
  app: FastifyInstance;
  hub: Hub;
  store: Store;
  close: () => Promise<void>;
}

const VERSION = '1.0.0';
const nameSchema = z.string().trim().min(1).max(60);

export async function buildApp(config: Config, catalog: ThemeCatalog): Promise<AppContext> {
  const app = Fastify({
    logger: config.testMode
      ? false
      : {
          level: config.logLevel,
          redact: ['req.headers.authorization', 'req.headers.cookie'],
        },
    trustProxy: config.trustProxy,
    bodyLimit: 256 * 1024,
  });
  const store = new Store(config.databasePath);
  const hub = new Hub(store, config, catalog, app.log);
  const limiter = createLimiter(config.testMode);

  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });

  // Security headers for every response.
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'",
    );
    return payload;
  });

  const tooMany = (reply: FastifyReply) =>
    reply.code(429).send({ error: 'rate_limited', message: 'Too many requests, please wait a moment.' });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HubError)
      return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err instanceof z.ZodError)
      return reply.code(400).send({ error: 'invalid', message: 'Invalid request' });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error({ err }, 'request failed');
    return reply
      .code(status)
      .send({ error: 'error', message: status >= 500 ? 'Internal error' : (err as Error).message });
  });

  function auth(req: FastifyRequest, kinds: TokenRow['kind'][]): TokenRow {
    const h = req.headers.authorization;
    const token = typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : '';
    const row = hub.resolveToken(token);
    if (!row || !kinds.includes(row.kind)) throw new HubError(401, 'unauthorized', 'Not authorized');
    return row;
  }

  // ---------------------------------------------------------------------------
  // REST API
  // ---------------------------------------------------------------------------
  app.get('/api/health', async () => ({ ok: true, version: VERSION, time: Date.now() }));

  app.post('/api/sessions', async (req, reply) => {
    if (!limiter.take('createSession', clientIp(req, config))) return tooMany(reply);
    const body = z
      .object({ name: nameSchema.optional(), themeId: z.string().max(64).optional() })
      .parse(req.body ?? {});
    const { state, ownerToken, ownerId } = hub.createSession(body.name ?? 'Meine Show', body.themeId);
    return reply.code(201).send({ sessionId: state.id, ownerToken, controllerId: ownerId });
  });

  app.post('/api/sessions/recover', async (req, reply) => {
    if (!limiter.take('recover', clientIp(req, config))) return tooMany(reply);
    const body = z.object({ recoveryKey: z.string().min(20).max(200) }).parse(req.body);
    const row = hub.resolveToken(body.recoveryKey.trim());
    if (!row || row.kind !== 'owner')
      return reply.code(401).send({ error: 'unauthorized', message: 'Unknown recovery key' });
    return { sessionId: row.session_id, controllerId: row.subject_id };
  });

  app.post('/api/sessions/rotate-owner', async (req) => {
    const row = auth(req, ['owner']);
    return { ownerToken: hub.rotateOwner(row) };
  });

  app.delete('/api/sessions/current', async (req) => {
    const row = auth(req, ['owner']);
    hub.deleteSession(row.session_id);
    return { ok: true };
  });

  app.post('/api/pairing-code', async (req, reply) => {
    if (!limiter.take('rest', clientIp(req, config))) return tooMany(reply);
    const row = auth(req, ['owner', 'controller']);
    return hub.issueCode(row.session_id, 'pair');
  });

  app.post('/api/invites', async (req, reply) => {
    if (!limiter.take('rest', clientIp(req, config))) return tooMany(reply);
    const row = auth(req, ['owner']);
    return hub.issueCode(row.session_id, 'invite');
  });

  app.post('/api/pair', async (req, reply) => {
    const ip = clientIp(req, config);
    if (!limiter.take('pair', ip) || !limiter.take('globalFailedPair', 'all', Date.now(), 0))
      return tooMany(reply);
    const body = z.object({ code: z.string().min(4).max(20), name: nameSchema }).parse(req.body);
    const res = hub.requestPairing(body.code, body.name);
    if (!res) {
      limiter.take('globalFailedPair', 'all');
      return reply.code(404).send({ error: 'invalid_code', message: 'Code unknown or expired' });
    }
    return reply.code(201).send(res);
  });

  app.post('/api/join', async (req, reply) => {
    if (!limiter.take('join', clientIp(req, config))) return tooMany(reply);
    const body = z.object({ code: z.string().min(4).max(20), name: nameSchema }).parse(req.body);
    const res = hub.redeemInvite(body.code, body.name);
    if (!res) return reply.code(404).send({ error: 'invalid_code', message: 'Invite unknown or expired' });
    return reply.code(201).send(res);
  });

  app.get('/api/sessions/export', async (req) => {
    const row = auth(req, ['owner', 'controller']);
    const state = hub.getState(row.session_id);
    if (!state) throw new HubError(404, 'not_found', 'Show not found');
    return {
      format: 'spectrastage-show',
      version: 1,
      exportedAt: Date.now(),
      show: {
        name: state.name,
        kidsSafe: state.kidsSafe,
        defaultThemeId: state.defaultThemeId,
        surfaces: state.surfaces,
        outputs: state.outputs,
        playlists: state.playlists,
        ambient: state.ambient,
      },
    };
  });

  app.post('/api/sessions/import', async (req) => {
    const row = auth(req, ['owner']);
    const body = z
      .object({
        format: z.literal('spectrastage-show'),
        show: z.object({
          kidsSafe: z.boolean().optional(),
          defaultThemeId: z.string().max(64).optional(),
          surfaces: z.array(SurfaceSchema).max(32).optional(),
          outputs: z.array(OutputSchema).max(16).optional(),
          playlists: z.array(PlaylistSchema).max(100).optional(),
          ambient: StageAmbientSchema.optional(),
        }),
      })
      .parse(req.body);
    hub.importState(row.session_id, body.show, 'import');
    return { ok: true };
  });

  app.get('/api/sessions/audit', async (req) => {
    const row = auth(req, ['owner', 'controller']);
    return { entries: hub.audit(row.session_id) };
  });

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------
  const allowedOrigin = config.publicUrl ? new URL(config.publicUrl).origin : null;

  app.get('/ws', { websocket: true }, (socket, req) => {
    const ip = clientIp(req, config);
    const origin = req.headers.origin;
    const send = (msg: ServerMessage) => socket.readyState === 1 && socket.send(JSON.stringify(msg));
    if (!limiter.take('wsConnect', ip)) {
      send({ type: 'error', code: 'rate_limited', message: 'Too many connections' });
      socket.close(4429, 'rate limited');
      return;
    }
    if (allowedOrigin && origin && origin !== allowedOrigin) {
      socket.close(4403, 'origin not allowed');
      return;
    }
    let client: Client | null = null;
    const helloTimer = setTimeout(() => !client && socket.close(4408, 'hello timeout'), 10_000);

    socket.on('pong', () => {
      if (client) client.alive = true;
    });

    socket.on('message', (raw: Buffer) => {
      if (!limiter.take('wsMessage', ip)) {
        send({ type: 'error', code: 'rate_limited', message: 'Slow down' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        socket.close(4400, 'bad json');
        return;
      }
      const res = ClientMessageSchema.safeParse(parsed);
      if (!res.success) {
        const id = (parsed as { id?: unknown })?.id;
        if (typeof id === 'string' && (parsed as { type?: unknown }).type === 'cmd') {
          send({ type: 'nack', id, code: 'invalid', message: 'Invalid command' });
        } else send({ type: 'error', code: 'protocol', message: 'Invalid message' });
        return;
      }
      const msg = res.data;
      if (msg.type === 'ping') {
        send({ type: 'pong', t: msg.t, serverTime: Date.now() });
        return;
      }
      if (!client) {
        if (msg.type !== 'hello') {
          socket.close(4401, 'hello required');
          return;
        }
        if (msg.protocol !== PROTOCOL_VERSION) {
          send({ type: 'error', code: 'protocol', message: 'Please reload the page (new version).' });
          socket.close(4426, 'protocol mismatch');
          return;
        }
        let row = hub.resolveToken(msg.token);
        if (!row) {
          send({ type: 'error', code: 'unauthorized', message: 'Unknown or revoked token' });
          socket.close(4401, 'unauthorized');
          return;
        }
        let role = row.kind as Client['role'];
        if (row.kind === 'pending') {
          // Approved while disconnected? Hand out the device token now.
          const token = hub.upgradePending(row);
          if (token) {
            send({ type: 'approved', deviceToken: token, deviceId: row.subject_id });
            row = { ...row, kind: 'device' };
            role = 'device';
          }
        }
        clearTimeout(helloTimer);
        client = {
          ws: socket,
          role,
          sessionId: row.session_id,
          subjectId: row.subject_id,
          clientId: msg.clientId,
          alive: true,
        };
        send({
          type: 'welcome',
          role,
          subjectId: row.subject_id,
          sessionId: row.session_id,
          serverTime: Date.now(),
          protocol: PROTOCOL_VERSION,
        });
        if (!hub.attach(client)) {
          send({ type: 'error', code: 'revoked', message: 'Access was revoked' });
          socket.close(4401, 'revoked');
          client = null;
        }
        return;
      }
      switch (msg.type) {
        case 'hello':
          return;
        case 'cmd':
          send(hub.execute(client, msg.id, msg.cmd));
          return;
        case 'telemetry':
          hub.handleTelemetry(client, msg.telemetry);
          return;
        case 'preview':
          hub.relayPreview(client, msg.outputId, msg.profile);
          return;
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (client) hub.detach(client);
    });
    socket.on('error', () => socket.terminate());
  });

  // Transport-level liveness: ping every 20s, drop sockets that missed one round (< Cloudflare's 100s idle).
  const heartbeat = setInterval(() => {
    for (const c of hub.allClients()) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, 20_000);
  const sweeper = setInterval(() => {
    hub.sweep();
    limiter.sweep();
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Static web app
  // ---------------------------------------------------------------------------
  const webRoot = config.webRoot ? resolve(config.webRoot) : null;
  if (webRoot && existsSync(join(webRoot, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webRoot,
      wildcard: false,
      // We set Cache-Control ourselves (immutable hashed assets, no-cache for HTML/SW).
      cacheControl: false,
      setHeaders(res, path) {
        if (path.includes(`${join(webRoot, 'assets')}`))
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'not_found' });
      }
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    });
  }

  const close = async () => {
    clearInterval(heartbeat);
    clearInterval(sweeper);
    for (const c of hub.allClients()) c.ws.close(1001, 'server shutdown');
    await app.close();
    store.close();
  };

  return { app, hub, store, close };
}
