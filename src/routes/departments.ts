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
  type DepartmentRow,
} from '../departments/repository';
import { listQuestions } from '../questions/repository';
import { listBrands } from '../brands/repository';
import { isUserFacingError } from '../http/errors';
import { setFlash } from '../http/flash';

/** Department CRUD — Admin only (M1). Recruiters select from the list; they do not edit it. */
export const departmentsRouter = Router();

departmentsRouter.use(requireRole('admin'));

async function departmentShowLocals(
  req: import('express').Request,
  department: DepartmentRow,
  extras: Record<string, unknown> = {}
) {
  const attached = await listDepartmentQuestions(department.department_id);
  return {
    title: department.name,
    department,
    attached,
    user: sessionUser(req),
    error: null as string | null,
    ...extras,
  };
}

async function departmentQuestionsLocals(
  req: import('express').Request,
  department: DepartmentRow,
  extras: Record<string, unknown> = {}
) {
  const attached = await listDepartmentQuestions(department.department_id);
  const attachedIds = new Set(attached.map((q) => q.question_id));
  const bank = await listQuestions(true, department.brand_id);
  const selectable = bank.filter(
    (q) =>
      (DEPARTMENT_APPLY_QUESTION_TYPES as readonly string[]).includes(q.type) &&
      (q.active || attachedIds.has(q.question_id))
  );
  return {
    title: `Apply questions · ${department.name}`,
    department,
    attached,
    selectable,
    user: sessionUser(req),
    error: null as string | null,
    ...extras,
  };
}

departmentsRouter.get('/', async (req, res, next) => {
  try {
    const [departments, brands] = await Promise.all([listDepartments(true), listBrands(true)]);
    res.render('departments/list', { title: 'Departments', departments, brands, user: sessionUser(req) });
  } catch (err) {
    next(err);
  }
});

departmentsRouter.get('/new', async (req, res, next) => {
  try {
    res.render('departments/form', {
      title: 'Add department',
      department: null,
      brands: await listBrands(false),
      error: null,
      user: sessionUser(req),
    });
  } catch (err) {
    next(err);
  }
});

departmentsRouter.post('/new', async (req, res, next) => {
  try {
    const parsed = parseDepartmentForm(req.body);
    const brands = await listBrands(false);
    if ('error' in parsed) {
      return res.status(400).render('departments/form', {
        title: 'Add department',
        department: req.body,
        brands,
        error: parsed.error,
        user: sessionUser(req),
      });
    }
    if (!parsed.brandId || !/^[0-9a-f-]{36}$/i.test(parsed.brandId)) {
      return res.status(400).render('departments/form', {
        title: 'Add department',
        department: req.body,
        brands,
        error: 'Select a brand.',
        user: sessionUser(req),
      });
    }
    try {
      const created = await createDepartment(parsed);
      res.redirect(`/departments/${created.department_id}`);
    } catch (err) {
      if (!isUserFacingError(err)) throw err;
      return res.status(400).render('departments/form', {
        title: 'Add department',
        department: req.body,
        brands,
        error: err.message,
        user: sessionUser(req),
      });
    }
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
    res.render('departments/show', await departmentShowLocals(req, department));
  } catch (err) {
    next(err);
  }
});

departmentsRouter.get('/:departmentId/questions', async (req, res, next) => {
  try {
    const department = await getDepartment(req.params.departmentId);
    if (!department) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    res.render('departments/questions', await departmentQuestionsLocals(req, department));
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
      brands: [],
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
        brands: [],
        error: parsed.error,
        user: sessionUser(req),
      });
    }
    try {
      await updateDepartment(department.department_id, parsed);
    } catch (err) {
      if (!isUserFacingError(err)) throw err;
      return res.status(400).render('departments/form', {
        title: `Edit ${department.name}`,
        department: { ...department, ...req.body },
        brands: [],
        error: err.message,
        user: sessionUser(req),
      });
    }
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
    try {
      await replaceDepartmentQuestions(
        department.department_id,
        parseDepartmentQuestionBuilder(req.body)
      );
    } catch (err) {
      if (!isUserFacingError(err)) throw err;
      return res.status(400).render(
        'departments/questions',
        await departmentQuestionsLocals(req, department, { error: err.message })
      );
    }
    setFlash(req, { type: 'success', message: 'Questions saved.' });
    req.session.save((saveErr) => {
      if (saveErr) return next(saveErr);
      res.redirect(`/departments/${department.department_id}`);
    });
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
