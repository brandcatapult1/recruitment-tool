import type { Request, Response, NextFunction } from 'express';

export type Flash = { type: 'success' | 'error'; message: string };

export function flashMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.locals.flash = req.session.flash ?? null;
  if (req.session.flash) delete req.session.flash;
  next();
}

export function setFlash(req: Request, flash: Flash): void {
  req.session.flash = flash;
}
