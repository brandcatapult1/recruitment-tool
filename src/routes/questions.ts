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

/**
 * Question bank CRUD — Admin, Recruiter and Partner (§4: Partner has the
 * same data permissions as Admin; M1 names Admin and Recruiter explicitly).
 * Recruiter cannot reach staff management; they can reach this.
 */
export const questionsRouter = Router();

questionsRouter.use(requireLogin);

questionsRouter.get('/', async (req, res, next) => {
  try {
    const questions = await listQuestions(true);
    res.render('questions/list', { title: 'Question bank', questions, user: sessionUser(req) });
  } catch (err) {
    next(err);
  }
});

questionsRouter.get('/new', (req, res) => {
  res.render('questions/form', {
    title: 'Add question',
    question: null,
    usage: null,
    types: QUESTION_TYPES,
    error: null,
    user: sessionUser(req),
  });
});

questionsRouter.post('/new', async (req, res, next) => {
  try {
    const parsed = parseQuestionForm(req.body);
    if ('error' in parsed) {
      return res.status(400).render('questions/form', {
        title: 'Add question',
        question: req.body,
        usage: null,
        types: QUESTION_TYPES,
        error: parsed.error,
        user: sessionUser(req),
      });
    }
    await createQuestion(parsed);
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
    res.render('questions/form', {
      title: 'Edit question',
      question,
      usage,
      types: QUESTION_TYPES,
      error: null,
      user: sessionUser(req),
    });
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
      return res.status(400).render('questions/form', {
        title: 'Edit question',
        question: { ...question, ...req.body },
        usage,
        types: QUESTION_TYPES,
        error: parsed.error,
        user: sessionUser(req),
      });
    }
    await updateQuestion(question.question_id, parsed);
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
