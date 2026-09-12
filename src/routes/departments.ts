import { Router } from 'express';
import { requireRole, sessionUser } from '../auth/middleware';
import { DEPARTMENT_APPLY_QUESTION_TYPES } from '../constants';
import { parseDepartmentForm, parseDepartmentQuestionBuilder } from './forms';
import {
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  setDepartmentActive,
  listDepartmentQuestions,
  replaceDepartmentQuestions,
} from '../departments/repository';
import { listQuestions } from '../questions/repository';

/** Department CRUD — Admin only (M1). Recruiters select from the list; they do not edit it. */
export const departmentsRouter = Router();

departmentsRouter.use(requireRole('admin'));

departmentsRouter.get('/', async (req, res, next) => {
  try {
    const departments = await listDepartments(true);
    res.render('departments/list', { title: 'Departments', departments, user: sessionUser(req) });
  } catch (err) {
    next(err);
  }
});

departmentsRouter.get('/new', (req, res) => {
  res.render('departments/form', {
    title: 'Add department',
    department: null,
    error: null,
    user: sessionUser(req),
  });
});

departmentsRouter.post('/new', async (req, res, next) => {
  try {
    const parsed = parseDepartmentForm(req.body);
    if ('error' in parsed) {
      return res.status(400).render('departments/form', {
        title: 'Add department',
        department: req.body,
        error: parsed.error,
        user: sessionUser(req),
      });
    }
    const created = await createDepartment(parsed);
    res.redirect(`/departments/${created.department_id}`);
  } catch (err) {
    next(err);
  }
});

departmentsRouter.get('/:departmentId', async (req, res, next) => {
  try {
    const department = await getDepartment(req.params.departmentId);
    if (!department) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    const attached = await listDepartmentQuestions(department.department_id);
    const attachedIds = new Set(attached.map((q) => q.question_id));
    const bank = await listQuestions(true);
    const selectable = bank.filter(
      (q) =>
        (DEPARTMENT_APPLY_QUESTION_TYPES as readonly string[]).includes(q.type) &&
        (q.active || attachedIds.has(q.question_id))
    );
    res.render('departments/show', {
      title: department.name,
      department,
      attached,
      selectable,
      user: sessionUser(req),
    });
  } catch (err) {
    next(err);
  }
});

departmentsRouter.get('/:departmentId/edit', async (req, res, next) => {
  try {
    const department = await getDepartment(req.params.departmentId);
    if (!department) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    res.render('departments/form', {
      title: `Edit ${department.name}`,
      department,
      error: null,
      user: sessionUser(req),
    });
  } catch (err) {
    next(err);
  }
});

departmentsRouter.post('/:departmentId/edit', async (req, res, next) => {
  try {
    const department = await getDepartment(req.params.departmentId);
    if (!department) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    const parsed = parseDepartmentForm(req.body);
    if ('error' in parsed) {
      return res.status(400).render('departments/form', {
        title: `Edit ${department.name}`,
        department: { ...department, ...req.body },
        error: parsed.error,
        user: sessionUser(req),
      });
    }
    await updateDepartment(department.department_id, parsed);
    res.redirect(`/departments/${department.department_id}`);
  } catch (err) {
    next(err);
  }
});

departmentsRouter.post('/:departmentId/questions', async (req, res, next) => {
  try {
    const department = await getDepartment(req.params.departmentId);
    if (!department) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    await replaceDepartmentQuestions(
      department.department_id,
      parseDepartmentQuestionBuilder(req.body)
    );
    res.redirect(`/departments/${department.department_id}`);
  } catch (err) {
    next(err);
  }
});

departmentsRouter.post('/:departmentId/deactivate', async (req, res, next) => {
  try {
    await setDepartmentActive(req.params.departmentId, false);
    res.redirect('/departments');
  } catch (err) {
    next(err);
  }
});

departmentsRouter.post('/:departmentId/reactivate', async (req, res, next) => {
  try {
    await setDepartmentActive(req.params.departmentId, true);
    res.redirect('/departments');
  } catch (err) {
    next(err);
  }
});
