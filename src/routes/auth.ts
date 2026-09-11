import { Router } from 'express';
import { getStaffByEmail } from '../staff/repository';
import { verifyPassword } from '../auth/passwords';
import { LOGIN_ROLES, type LoginRole } from '../constants';

export const authRouter = Router();

authRouter.get('/login', (req, res) => {
  if (req.session.staffId) return res.redirect('/');
  res.render('login', { title: 'Sign in', error: null, user: null });
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email ?? '').trim();
    const password = String(req.body.password ?? '');
    const fail = () =>
      res.status(401).render('login', { title: 'Sign in', error: 'Invalid email or password.', user: null });

    if (!email || !password) return fail();

    const staff = await getStaffByEmail(email);
    // Interviewers exist as data only (§4) — no login regardless of any
    // credentials. Deactivated staff cannot log in either.
    if (
      !staff ||
      !staff.active ||
      !staff.password_hash ||
      !(LOGIN_ROLES as readonly string[]).includes(staff.system_role)
    ) {
      return fail();
    }
    if (!(await verifyPassword(password, staff.password_hash))) return fail();

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.staffId = staff.staff_id;
      req.session.role = staff.system_role as LoginRole;
      req.session.name = staff.name;
      res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.redirect('/login');
  });
});
