import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { LoginRole } from '../constants';

/**
 * Role-based access control per PRD §4. Applied to page and API routes alike,
 * so restricted areas are unreachable "by URL or by API" (M0 acceptance
 * criteria).
 *
 * Role groups:
 * - requireLogin: any authenticated staff (admin, recruiter, partner).
 *   Candidate-level routes in later modules use this — all three roles have
 *   full candidate data access (§4).
 * - requireRole('admin'): staff management, enumeration/tag administration.
 * - requireRole('partner'): the Leadership Overview, exclusive to Partner.
 * - requireRole('admin', 'partner'): team dashboard (M8).
 *
 * Admin and Partner stay separate roles deliberately (§4 note): identical data
 * permissions, but Partner sees an extra dashboard and the event log must
 * distinguish who acted.
 */

export function requireLogin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.staffId) {
    if (req.accepts('html')) {
      res.redirect('/login');
    } else {
      res.status(401).json({ error: 'authentication required' });
    }
    return;
  }
  next();
}

export function requireRole(...roles: LoginRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session.staffId) {
      if (req.accepts('html')) {
        res.redirect('/login');
      } else {
        res.status(401).json({ error: 'authentication required' });
      }
      return;
    }
    if (!req.session.role || !roles.includes(req.session.role)) {
      res.status(403);
      if (req.accepts('html')) {
        res.render('forbidden', { title: 'Not allowed', user: sessionUser(req) });
      } else {
        res.json({ error: 'forbidden' });
      }
      return;
    }
    next();
  };
}

export function sessionUser(req: Request): { staffId: string; role: LoginRole; name: string } | null {
  if (!req.session.staffId || !req.session.role) return null;
  return { staffId: req.session.staffId, role: req.session.role, name: req.session.name ?? '' };
}
