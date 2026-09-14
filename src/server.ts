import path from 'path';
import express from 'express';
import { config } from './config';
import { runMigrations } from './db/migrate';
import { verifySchema } from './db/verify';
import { ensureAdminExists } from './bootstrap';
import { sessionMiddleware } from './auth/session';
import { authRouter } from './routes/auth';
import { staffRouter } from './routes/staff';
import { homeRouter } from './routes/home';
import { questionsRouter } from './routes/questions';
import { campaignsRouter } from './routes/campaigns';
import { departmentsRouter } from './routes/departments';
import { applyRouter } from './routes/apply';
import { filesRouter } from './routes/files';
import { sessionUser } from './auth/middleware';
import { flashMiddleware } from './http/flash';
import { label } from './labels';

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.resolve(process.cwd(), 'views'));
app.locals.label = label;
if (config.isProduction) app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/static', express.static(path.resolve(process.cwd(), 'public')));
app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'public/favicon.ico'));
});
app.use(sessionMiddleware);
app.use(flashMiddleware);
app.use((req, res, next) => {
  res.locals.path = req.path;
  next();
});

app.use(authRouter);
app.use(homeRouter);
app.use('/staff', staffRouter);
app.use('/questions', questionsRouter);
app.use('/campaigns', campaignsRouter);
app.use('/departments', departmentsRouter);
app.use(applyRouter);
app.use(filesRouter);

app.use((req, res) => {
  res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).render('error', { title: 'Something went wrong', user: sessionUser(req) });
});

/**
 * Startup sequence. There is no terminal in this deployment model, so boot is
 * the only place migrations and the admin bootstrap can run. Both are
 * idempotent and safe on every start. If either fails, the process exits
 * non-zero so the host keeps the previous deploy serving.
 */
async function start(): Promise<void> {
  await runMigrations();
  await verifySchema();
  await ensureAdminExists();
  app.listen(config.port, () => {
    console.log(`recruitment-tool listening on ${config.appBaseUrl} (port ${config.port})`);
  });
}

start().catch((err) => {
  console.error('[startup] failed:', err);
  process.exit(1);
});
