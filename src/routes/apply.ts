import { randomUUID } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import { getOpenCampaignBySlug } from '../campaigns/repository';
import { resolveSource } from '../campaigns/links';
import { loadLiveApplyQuestions } from '../snapshots';
import { submitApplication, type ApplyFields } from '../apply/submit';
import { FREE_TEXT_CHAR_LIMIT, FREE_TEXT_QUESTION_TYPES } from '../constants';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

export const applyRouter = Router();

applyRouter.get('/apply/:slug/thanks/:applicationId', (req, res) => {
  res.render('apply/thanks', { title: 'Application received' });
});

applyRouter.get('/apply/:slug/thanks', (req, res) => {
  res.render('apply/thanks', { title: 'Application received' });
});

applyRouter.get(['/apply/:slug', '/apply/:slug/:source'], async (req, res, next) => {
  try {
    const campaign = await getOpenCampaignBySlug(String(req.params.slug));
    if (!campaign) {
      return res.status(404).render('apply/not-found', { title: 'Not found' });
    }
    const source = resolveSource(req.params.source);
    const questions = await loadLiveApplyQuestions(campaign.campaign_id);
    res.render('apply/form', {
      title: campaign.role_title,
      campaign,
      source,
      questions,
      submissionId: randomUUID(),
      charLimit: FREE_TEXT_CHAR_LIMIT,
      freeTextTypes: FREE_TEXT_QUESTION_TYPES,
      error: null,
      values: {},
    });
  } catch (err) {
    next(err);
  }
});

applyRouter.post(
  ['/apply/:slug', '/apply/:slug/:source'],
  upload.fields([
    { name: 'cv', maxCount: 1 },
    { name: 'portfolio', maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const campaign = await getOpenCampaignBySlug(String(req.params.slug));
      if (!campaign) {
        return res.status(404).render('apply/not-found', { title: 'Not found' });
      }
      const source = resolveSource(req.params.source);
      const body = req.body as Record<string, unknown>;
      const files = req.files as { [field: string]: Express.Multer.File[] } | undefined;
      const fields = fieldsFromBody(body);
      const result = await submitApplication(
        campaign,
        source,
        fields,
        {
          cv: files?.cv?.[0] ? { buffer: files.cv[0].buffer, originalname: files.cv[0].originalname } : null,
          portfolio: files?.portfolio?.[0]
            ? { buffer: files.portfolio[0].buffer, originalname: files.portfolio[0].originalname }
            : null,
        },
        String(body.website ?? '')
      );

      if (result.kind === 'invalid') {
        const questions = await loadLiveApplyQuestions(campaign.campaign_id);
        return res.status(400).render('apply/form', {
          title: campaign.role_title,
          campaign,
          source,
          questions,
          submissionId: fields.submissionId || randomUUID(),
          charLimit: FREE_TEXT_CHAR_LIMIT,
          freeTextTypes: FREE_TEXT_QUESTION_TYPES,
          error: result.error,
          values: body,
        });
      }

      if (result.kind === 'honeypot') {
        return res.redirect(`/apply/${campaign.public_slug}/thanks`);
      }
      return res.redirect(`/apply/${campaign.public_slug}/thanks/${result.applicationId}`);
    } catch (err) {
      next(err);
    }
  }
);

function fieldsFromBody(body: Record<string, unknown>): ApplyFields {
  const answers: ApplyFields['answers'] = {};
  for (const [key, value] of Object.entries(body)) {
    if (!key.startsWith('q_')) continue;
    const id = key.slice(2);
    if (Array.isArray(value)) answers[id] = value.map(String);
    else if (value === '' || value == null) answers[id] = null;
    else answers[id] = String(value);
  }
  return {
    submissionId: String(body.submission_id ?? randomUUID()),
    fullName: String(body.full_name ?? ''),
    phone: String(body.phone ?? ''),
    email: String(body.email ?? ''),
    city: String(body.city ?? ''),
    currentComp: String(body.current_comp ?? ''),
    notCurrentlyEmployed: String(body.not_currently_employed ?? '') === 'true',
    earliestJoinDate: String(body.earliest_join_date ?? ''),
    yearsInDiscipline: String(body.years_in_discipline ?? ''),
    motivation: String(body.motivation ?? ''),
    workLinks: String(body.work_links ?? ''),
    answers,
  };
}
