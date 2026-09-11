import { Router } from 'express';
import { requireRole, sessionUser } from '../auth/middleware';
import {
  listStaff,
  getStaff,
  createStaff,
  updateStaff,
  setStaffActive,
} from '../staff/repository';
import { hashPassword } from '../auth/passwords';
import { SYSTEM_ROLES, LOGIN_ROLES, type SystemRole } from '../constants';

/**
 * Staff CRUD — Admin only (§4, M0 scope). The requireRole('admin') guard on
 * the whole router makes every page and form action unreachable for
 * Recruiter and Partner, by URL or by API.
 */
export const staffRouter = Router();

staffRouter.use(requireRole('admin'));

staffRouter.get('/', async (req, res, next) => {
  try {
    const staff = await listStaff();
    res.render('staff/list', { title: 'Staff', staff, user: sessionUser(req) });
  } catch (err) {
    next(err);
  }
});

staffRouter.get('/new', (req, res) => {
  res.render('staff/form', {
    title: 'Add staff member',
    member: null,
    roles: SYSTEM_ROLES,
    error: null,
    user: sessionUser(req),
  });
});

staffRouter.post('/new', async (req, res, next) => {
  try {
    const parsed = parseStaffForm(req.body);
    if ('error' in parsed) {
      return res.status(400).render('staff/form', {
        title: 'Add staff member',
        member: req.body,
        roles: SYSTEM_ROLES,
        error: parsed.error,
        user: sessionUser(req),
      });
    }
    const passwordHash =
      parsed.password && isLoginRole(parsed.systemRole) ? await hashPassword(parsed.password) : null;
    await createStaff({
      name: parsed.name,
      department: parsed.department,
      systemRole: parsed.systemRole,
      email: parsed.email,
      passwordHash,
    });
    res.redirect('/staff');
  } catch (err) {
    next(err);
  }
});

staffRouter.get('/:staffId/edit', async (req, res, next) => {
  try {
    const member = await getStaff(req.params.staffId);
    if (!member) return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    res.render('staff/form', {
      title: `Edit ${member.name}`,
      member,
      roles: SYSTEM_ROLES,
      error: null,
      user: sessionUser(req),
    });
  } catch (err) {
    next(err);
  }
});

staffRouter.post('/:staffId/edit', async (req, res, next) => {
  try {
    const member = await getStaff(req.params.staffId);
    if (!member) return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    const parsed = parseStaffForm(req.body);
    if ('error' in parsed) {
      return res.status(400).render('staff/form', {
        title: `Edit ${member.name}`,
        member: { ...member, ...req.body },
        roles: SYSTEM_ROLES,
        error: parsed.error,
        user: sessionUser(req),
      });
    }
    const passwordHash =
      parsed.password && isLoginRole(parsed.systemRole) ? await hashPassword(parsed.password) : undefined;
    await updateStaff(member.staff_id, {
      name: parsed.name,
      department: parsed.department,
      systemRole: parsed.systemRole,
      email: parsed.email,
      passwordHash,
    });
    res.redirect('/staff');
  } catch (err) {
    next(err);
  }
});

// Deactivate / reactivate — never delete (§5.7, R3).
staffRouter.post('/:staffId/deactivate', async (req, res, next) => {
  try {
    await setStaffActive(req.params.staffId, false);
    res.redirect('/staff');
  } catch (err) {
    next(err);
  }
});

staffRouter.post('/:staffId/reactivate', async (req, res, next) => {
  try {
    await setStaffActive(req.params.staffId, true);
    res.redirect('/staff');
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------

interface ParsedStaffForm {
  name: string;
  department: string | null;
  systemRole: SystemRole;
  email: string | null;
  password: string | null;
}

function parseStaffForm(body: Record<string, unknown>): ParsedStaffForm | { error: string } {
  const name = String(body.name ?? '').trim();
  const department = String(body.department ?? '').trim() || null;
  const systemRole = String(body.system_role ?? '');
  const email = String(body.email ?? '').trim() || null;
  const password = String(body.password ?? '') || null;

  if (!name) return { error: 'Name is required.' };
  if (!(SYSTEM_ROLES as readonly string[]).includes(systemRole)) {
    return { error: 'Select a valid role.' };
  }
  const role = systemRole as SystemRole;
  if (isLoginRole(role) && !email) {
    return { error: 'Email is required for roles that log in.' };
  }
  if (!isLoginRole(role) && password) {
    return { error: 'Interviewers have no login (§4); do not set a password.' };
  }
  return { name, department, systemRole: role, email, password };
}

function isLoginRole(role: SystemRole): boolean {
  return (LOGIN_ROLES as readonly string[]).includes(role);
}
