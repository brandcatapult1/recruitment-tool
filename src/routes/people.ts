import { Router } from 'express';
import { requireLogin, sessionUser } from '../auth/middleware';
import { PERSON_TAGS } from '../constants';
import { isUserFacingError } from '../http/errors';
import { setFlash } from '../http/flash';
import {
  searchPeople,
  getPerson,
  listPersonApplications,
  listTimeline,
  priorInterviewSummaries,
  setDoNotContact,
  setPersonTags,
  mergePeople,
  type PersonRow,
} from '../people/repository';

export const peopleRouter = Router();

peopleRouter.use(requireLogin);

peopleRouter.get('/', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const people = await searchPeople(q);
    res.render('people/list', {
      title: 'People',
      q,
      people,
      user: sessionUser(req),
    });
  } catch (err) {
    next(err);
  }
});

peopleRouter.get('/export.csv', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const people = await searchPeople(q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="people.csv"');
    const header = ['name', 'phone', 'email', 'city', 'applications', 'do_not_contact', 'tags'];
    const lines = [header.join(',')];
    for (const p of people) {
      lines.push(
        [
          csv(p.full_name),
          csv(p.phone),
          csv(p.email ?? ''),
          csv(p.city ?? ''),
          String(p.application_count),
          p.do_not_contact ? 'true' : 'false',
          csv((p.tags ?? []).join('|')),
        ].join(',')
      );
    }
    res.send(lines.join('\n'));
  } catch (err) {
    next(err);
  }
});

peopleRouter.get('/:personId', async (req, res, next) => {
  try {
    const person = await loadVisiblePerson(req.params.personId);
    if (!person) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    if (person.merged_into) {
      return res.redirect(`/people/${person.merged_into}`);
    }
    const [applications, timeline, prior] = await Promise.all([
      listPersonApplications(person.person_id),
      listTimeline(person.person_id),
      priorInterviewSummaries(person.person_id),
    ]);
    res.render('people/show', {
      title: person.full_name,
      person,
      applications,
      timeline,
      prior,
      tags: PERSON_TAGS,
      user: sessionUser(req),
    });
  } catch (err) {
    next(err);
  }
});

peopleRouter.post('/:personId/do-not-contact', async (req, res, next) => {
  try {
    const person = await loadVisiblePerson(req.params.personId);
    if (!person || person.merged_into) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    await setDoNotContact(person.person_id, String(req.body.value) === 'true');
    setFlash(req, {
      type: 'success',
      message: String(req.body.value) === 'true' ? 'Marked do not contact.' : 'Do-not-contact cleared.',
    });
    req.session.save((err) => {
      if (err) return next(err);
      res.redirect(`/people/${person.person_id}`);
    });
  } catch (err) {
    next(err);
  }
});

peopleRouter.post('/:personId/tags', async (req, res, next) => {
  try {
    const person = await loadVisiblePerson(req.params.personId);
    if (!person || person.merged_into) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    const raw = req.body.tag;
    const tags = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];
    try {
      await setPersonTags(person.person_id, tags);
    } catch (err) {
      if (!isUserFacingError(err)) throw err;
      setFlash(req, { type: 'error', message: err.message });
      return req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.redirect(`/people/${person.person_id}`);
      });
    }
    setFlash(req, { type: 'success', message: 'Tags saved.' });
    req.session.save((err) => {
      if (err) return next(err);
      res.redirect(`/people/${person.person_id}`);
    });
  } catch (err) {
    next(err);
  }
});

peopleRouter.get('/:personId/merge', async (req, res, next) => {
  try {
    const person = await loadVisiblePerson(req.params.personId);
    if (!person || person.merged_into) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const matches = q.trim()
      ? (await searchPeople(q)).filter((p) => p.person_id !== person.person_id)
      : [];
    res.render('people/merge-search', {
      title: `Merge ${person.full_name}`,
      person,
      q,
      matches,
      user: sessionUser(req),
    });
  } catch (err) {
    next(err);
  }
});

peopleRouter.get('/:personId/merge/:otherId', async (req, res, next) => {
  try {
    const locals = await mergeLocals(req.params.personId, req.params.otherId);
    if (!locals) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    res.render('people/merge', { ...locals, error: null, user: sessionUser(req) });
  } catch (err) {
    next(err);
  }
});

peopleRouter.post('/:personId/merge/:otherId', async (req, res, next) => {
  try {
    const locals = await mergeLocals(req.params.personId, req.params.otherId);
    if (!locals) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    const confirmed = String(req.body.confirm ?? '') === 'on';
    const survivorId = String(req.body.survivor ?? '');
    if (!confirmed) {
      return res.status(400).render('people/merge', {
        ...locals,
        error: 'Tick the box to confirm. This cannot be undone.',
        user: sessionUser(req),
      });
    }
    if (survivorId !== locals.left.person_id && survivorId !== locals.right.person_id) {
      return res.status(400).render('people/merge', {
        ...locals,
        error: 'Choose which record to keep.',
        user: sessionUser(req),
      });
    }
    const loserId = survivorId === locals.left.person_id ? locals.right.person_id : locals.left.person_id;
    const user = sessionUser(req);
    try {
      await mergePeople(survivorId, loserId, user!.staffId);
    } catch (err) {
      if (!isUserFacingError(err)) throw err;
      return res.status(400).render('people/merge', {
        ...locals,
        error: err.message,
        user,
      });
    }
    setFlash(req, { type: 'success', message: 'Records merged.' });
    req.session.save((err) => {
      if (err) return next(err);
      res.redirect(`/people/${survivorId}`);
    });
  } catch (err) {
    next(err);
  }
});

async function loadVisiblePerson(personId: string): Promise<PersonRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(personId)) return null;
  return getPerson(personId);
}

async function mergeLocals(idA: string, idB: string) {
  const [left, right] = await Promise.all([loadVisiblePerson(idA), loadVisiblePerson(idB)]);
  if (!left || !right || left.merged_into || right.merged_into || left.person_id === right.person_id) {
    return null;
  }
  return {
    title: 'Confirm merge',
    left,
    right,
  };
}

function csv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
