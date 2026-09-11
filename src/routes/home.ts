import { Router } from 'express';
import { requireLogin, requireRole, sessionUser } from '../auth/middleware';

export const homeRouter = Router();

homeRouter.get('/', requireLogin, (req, res) => {
  res.render('home', { title: 'Home', user: sessionUser(req) });
});

/**
 * Leadership Overview — Partner only (§4, M0 acceptance criteria). The
 * dashboard itself is built in M8; the route and its guard exist from M0 so
 * the access rule is enforced from day one.
 */
homeRouter.get('/leadership', requireRole('partner'), (req, res) => {
  res.render('leadership', { title: 'Leadership Overview', user: sessionUser(req) });
});
