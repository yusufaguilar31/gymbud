import http from 'http';
import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import 'dotenv/config';

import { initializeDatabase, db } from './server/db.ts';
import { seedInitialData } from './server/seed.ts';
import { verifySessionToken, SESSION_COOKIE_NAME } from './server/auth.ts';
import { registerRoutes, type RealtimeHub } from './server/routes.ts';

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  initializeDatabase();
  seedInitialData();

  const app = express();
  app.use(cookieParser());

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const userSockets = new Map<string, Set<WebSocket>>();

  const hub: RealtimeHub = {
    sendToUser(userId: string, event: string, payload: unknown) {
      const sockets = userSockets.get(userId);
      if (!sockets) return;
      const frame = JSON.stringify({ event, payload });
      for (const sock of sockets) {
        if (sock.readyState === WebSocket.OPEN) {
          sock.send(frame);
        }
      }
    },
    isUserOnline(userId: string) {
      const sockets = userSockets.get(userId);
      return Boolean(sockets && sockets.size > 0);
    },
  };

  wss.on('connection', (ws, req) => {
    const cookieHeader = req.headers.cookie || '';
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map((pair) => {
        const idx = pair.indexOf('=');
        if (idx === -1) return ['', ''];
        return [pair.slice(0, idx).trim(), decodeURIComponent(pair.slice(idx + 1).trim())];
      })
    );

    const reqUrl = new URL(req.url || '/ws', 'http://localhost');
    const token = cookies[SESSION_COOKIE_NAME] || reqUrl.searchParams.get('token') || undefined;
    const session = verifySessionToken(token);
    if (!session) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    const userId = session.uid;
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.event === 'typing' && msg.conversation_id) {
          const access = db
            .prepare(
              `SELECT m.user_a_id, m.user_b_id
               FROM conversations c
               JOIN matches m ON m.id = c.match_id
               WHERE c.id = ? AND m.status = 'active'`
            )
            .get(String(msg.conversation_id)) as { user_a_id: string; user_b_id: string } | undefined;
          if (access && (access.user_a_id === userId || access.user_b_id === userId)) {
            const partnerId = access.user_a_id === userId ? access.user_b_id : access.user_a_id;
            hub.sendToUser(partnerId, 'typing', {
              conversation_id: msg.conversation_id,
              user_id: userId,
              is_typing: Boolean(msg.is_typing),
            });
          }
        }
      } catch {
        // Ignore malformed websocket frames
      }
    });

    ws.on('close', () => {
      const set = userSockets.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) userSockets.delete(userId);
      }
    });
  });

  registerRoutes(app, hub);

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`GYMBUD server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start GYMBUD server:', err);
  process.exit(1);
});
