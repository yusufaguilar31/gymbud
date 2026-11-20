import express from 'express';
import cookieParser from 'cookie-parser';
import { initializeDatabase } from '../server/db.ts';
import { seedInitialData } from '../server/seed.ts';
import { registerRoutes, type RealtimeHub } from '../server/routes.ts';

export const config = {
  api: {
    bodyParser: false,
  },
};

const app = express();
let initialized = false;

const serverlessHub: RealtimeHub = {
  sendToUser() {
    // Persistent WebSockets are disabled in serverless mode; client polls notifications/messages normally.
  },
  isUserOnline() {
    return false;
  },
};

function ensureInitialized(): void {
  if (initialized) return;
  initializeDatabase();
  seedInitialData();

  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  registerRoutes(app, serverlessHub);
  initialized = true;
}

export default function handler(req: express.Request, res: express.Response) {
  ensureInitialized();
  return app(req, res);
}
