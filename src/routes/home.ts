import { Router } from 'express';
import { requireLogin, requireRole, sessionUser } from '../auth/middleware';
import { listAgedForOwner } from '../applications/repository';

export const homeRouter = Router();

homeRouter.get('/', requireLogin, async (req, res, next) => {
  try {
    const user = sessionUser(req);
    const aged = user ? await listAgedForOwner(user.staffId) : [];
    res.render('home', {
      title: 'Home',
      user,
      aged,
      formatWeekdayWait,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Leadership Overview — Partner only (§4, M0 acceptance criteria). The
 * dashboard itself is built in M8; the route and its guard exist from M0 so
 * the access rule is enforced from day one.
 */
homeRouter.get('/leadership', requireRole('partner'), (req, res) => {
  res.render('leadership', { title: 'Leadership Overview', user: sessionUser(req) });
});

/** Human wait string from weekday clock-hours. */
function formatWeekdayWait(hours: number): string {
  if (hours < 48) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 10) return `${days.toFixed(1)} weekday days`;
  return `${Math.round(days)} weekday days`;
}
