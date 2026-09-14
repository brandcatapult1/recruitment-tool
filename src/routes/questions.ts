import { Router } from 'express';
import { requireLogin, sessionUser } from '../auth/middleware';
import { QUESTION_TYPES } from '../constants';
import { parseQuestionForm } from './forms';
import {
  listQuestions,
  getQuestion,
  createQuestion,
  updateQuestion,
  setQuestionActive,
  getQuestionUsage,
} from '../questions/repository';
import { listBrands } from '../brands/repository';
import { isUserFacingError } from '../http/errors';

/**
 * Question bank CRUD — Admin, Recruiter and Partner (§4: Partner has the
 * same data permissions as Admin; M1 names Admin and Recruiter explicitly).
 * Recruiter cannot reach staff management; they can reach this.
 *
 * Each question belongs to one brand, set at create. Builders only list
 * questions from the department or campaign's brand.
 */
export const questionsRouter = Router();

questionsRouter.use(requireLogin);

async function questionFormLocals(
  req: import('express').Request,
  extras: Record<string, unknown>
) {
  return {
    types: QUESTION_TYPES,
    brands: await listBrands(false),
    user: sessionUser(req),
    error: null as string | null,
    ...extras,
  };
}

questionsRouter.get('/', async (req, res, next) => {
  try {
    const [questions, brands] = await Promise.all([listQuestions(true), listBrands(true)]);
    res.render('questions/list', { title: 'Question bank', questions, brands, user: sessionUser(req) });
  } catch (err) {
    next(err);
  }
});

questionsRouter.get('/new', async (req, res, next) => {
  try {
    res.render(
      'questions/form',
      await questionFormLocals(req, { title: 'Add question', question: null, usage: null })
    );
  } catch (err) {
    next(err);
  }
});

questionsRouter.post('/new', async (req, res, next) => {
  try {
    const parsed = parseQuestionForm(req.body);
    if ('error' in parsed) {
      return res.status(400).render(
        'questions/form',
        await questionFormLocals(req, {
          title: 'Add question',
          question: req.body,
          usage: null,
          error: parsed.error,
        })
      );
    }
    if (!parsed.brandId || !/^[0-9a-f-]{36}$/i.test(parsed.brandId)) {
      return res.status(400).render(
        'questions/form',
        await questionFormLocals(req, {
          title: 'Add question',
          question: req.body,
          usage: null,
          error: 'Select a brand.',
        })
      );
    }
    try {
      await createQuestion(parsed);
    } catch (err) {
      if (!isUserFacingError(err)) throw err;
      return res.status(400).render(
        'questions/form',
        await questionFormLocals(req, {
          title: 'Add question',
          question: req.body,
          usage: null,
          error: err.message,
        })
      );
    }
    res.redirect('/questions');
  } catch (err) {
    next(err);
  }
});

questionsRouter.get('/:questionId/edit', async (req, res, next) => {
  try {
    const question = await getQuestion(req.params.questionId);
    if (!question) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    const usage = await getQuestionUsage(question.question_id);
    res.render(
      'questions/form',
      await questionFormLocals(req, { title: 'Edit question', question, usage })
    );
  } catch (err) {
    next(err);
  }
});

questionsRouter.post('/:questionId/edit', async (req, res, next) => {
  try {
    const question = await getQuestion(req.params.questionId);
    if (!question) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    const parsed = parseQuestionForm(req.body);
    if ('error' in parsed) {
      const usage = await getQuestionUsage(question.question_id);
      return res.status(400).render(
        'questions/form',
        await questionFormLocals(req, {
          title: 'Edit question',
          question: { ...question, ...req.body },
          usage,
          error: parsed.error,
        })
      );
    }
    try {
      await updateQuestion(question.question_id, parsed);
    } catch (err) {
      if (!isUserFacingError(err)) throw err;
      const usage = await getQuestionUsage(question.question_id);
      return res.status(400).render(
        'questions/form',
        await questionFormLocals(req, {
          title: 'Edit question',
          question: { ...question, ...req.body },
          usage,
          error: err.message,
        })
      );
    }
    res.redirect('/questions');
  } catch (err) {
    next(err);
  }
});

questionsRouter.post('/:questionId/deactivate', async (req, res, next) => {
  try {
    await setQuestionActive(req.params.questionId, false);
    res.redirect('/questions');
  } catch (err) {
    next(err);
  }
});

questionsRouter.post('/:questionId/reactivate', async (req, res, next) => {
  try {
    await setQuestionActive(req.params.questionId, true);
    res.redirect('/questions');
  } catch (err) {
    next(err);
  }
});
