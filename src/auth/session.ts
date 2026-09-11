import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool } from '../db/pool';
import { config } from '../config';
import type { LoginRole } from '../constants';

declare module 'express-session' {
  interface SessionData {
    staffId?: string;
    role?: LoginRole;
    name?: string;
  }
}

const PgStore = connectPgSimple(session);

/**
 * Sessions are stored in Postgres, never on the app server (§13.1: the app
 * layer is stateless; Render/Hostinger instances are disposable).
 */
export const sessionMiddleware = session({
  store: new PgStore({ pool, tableName: 'session' }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: 1000 * 60 * 60 * 12, // 12 hours
  },
});
