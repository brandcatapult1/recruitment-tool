/**
 * M4.5 — Manual candidate entry routes.
 *
 * Note: the repo's prd.md Section 8 predates M4.5 (it jumps from M4 to M5).
 * This module is intentional product scope, not out-of-scope drift from the
 * checked-in PRD copy.
 */
import { randomUUID } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import { requireLogin, sessionUser } from '../auth/middleware';
import {
  APPLY_CITIES,
  FREE_TEXT_CHAR_LIMIT,
  FREE_TEXT_QUESTION_TYPES,
  SOURCES,
} from '../constants';
import { listCampaigns, getCampaign } from '../campaigns/repository';
import { loadLiveApplyQuestions } from '../snapshots';
import { submitManualApplication, type ManualEntryFields } from '../apply/manual';
import { listSelectableInterviewers } from '../staff/repository';
import { setFlash } from '../http/flash';
import { pool } from '../db/pool';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

export const candidatesRouter = Router();
candidatesRouter.use(requireLogin);

candidatesRouter.get('/candidates/new', async (req, res, next) => {
  try {
    const campaignId = String(req.query.campaign_id ?? '').trim();
    const campaigns = (await listCampaigns()).filter((c) => c.status === 'open');
    const campaign = campaignId ? await getCampaign(campaignId) : null;
    if (campaignId && (!campaign || campaign.status !== 'open')) {
      setFlash(req, { type: 'error', message: 'Pick an open campaign.' });
      return res.redirect('/candidates/new');
    }
    const questions = campaign ? await loadLiveApplyQuestions(campaign.campaign_id) : [];
    res.render('candidates/new', {
      title: 'Add candidate',
      user: sessionUser(req),
      campaigns,
      campaign,
      questions,
      staff: await listSelectableInterviewers(),
      sources: SOURCES,
      cities: APPLY_CITIES,
      charLimit: FREE_TEXT_CHAR_LIMIT,
      freeTextTypes: FREE_TEXT_QUESTION_TYPES,
      submissionId: randomUUID(),
      error: null,
      values: {},
    });
  } catch (err) {
    next(err);
  }
});

candidatesRouter.post(
  '/candidates/new',
  upload.fields([
    { name: 'cv', maxCount: 1 },
    { name: 'portfolio', maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const user = sessionUser(req);
      if (!user) return res.redirect('/login');

      const body = req.body as Record<string, unknown>;
      const campaignId = String(body.campaign_id ?? '').trim();
      const campaigns = (await listCampaigns()).filter((c) => c.status === 'open');
      const campaign = campaignId ? await getCampaign(campaignId) : null;
      const questions = campaign ? await loadLiveApplyQuestions(campaign.campaign_id) : [];
      const staff = await listSelectableInterviewers();
      const values = bodyAsValues(body);

      const renderForm = (error: string) =>
        res.status(400).render('candidates/new', {
          title: 'Add candidate',
          user,
          campaigns,
          campaign,
          questions,
          staff,
          sources: SOURCES,
          cities: APPLY_CITIES,
          charLimit: FREE_TEXT_CHAR_LIMIT,
          freeTextTypes: FREE_TEXT_QUESTION_TYPES,
          submissionId: String(body.submission_id ?? randomUUID()),
          error,
          values,
        });

      if (!campaign || campaign.status !== 'open') {
        return renderForm('Pick an open campaign.');
      }

      const files = req.files as { [field: string]: Express.Multer.File[] } | undefined;
      const fields = fieldsFromBody(body);
      const result = await submitManualApplication(
        campaign,
        fields,
        {
          cv: files?.cv?.[0]
            ? { buffer: files.cv[0].buffer, originalname: files.cv[0].originalname }
            : null,
          portfolio: files?.portfolio?.[0]
            ? { buffer: files.portfolio[0].buffer, originalname: files.portfolio[0].originalname }
            : null,
        },
        user.staffId
      );

      if (result.kind === 'invalid') return renderForm(result.error);
      if (result.kind === 'honeypot') return renderForm('Could not save that entry.');

      const personId = await personIdForApplication(result.applicationId);
      if (result.kind === 'repeat' || result.kind === 'idempotent') {
        setFlash(req, {
          type: 'success',
          message:
            'Already applied to this campaign — opened the existing person. No duplicate was created.',
        });
      } else {
        setFlash(req, { type: 'success', message: 'Candidate added at Applied.' });
      }
      return res.redirect(personId ? `/people/${personId}` : `/campaigns/${campaign.campaign_id}/board`);
    } catch (err) {
      next(err);
    }
  }
);

function fieldsFromBody(body: Record<string, unknown>): ManualEntryFields {
  const answers: ManualEntryFields['answers'] = {};
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
    workLinks: String(body.work_links ?? ''),
    source: String(body.source ?? ''),
    referrerName: String(body.referrer_name ?? ''),
    referrerStaffId: String(body.referrer_staff_id ?? ''),
    dataProvenance: String(body.data_provenance ?? ''),
    answers,
  };
}

function bodyAsValues(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith('q_') && Array.isArray(value)) out[key] = value.map(String);
  }
  return out;
}

async function personIdForApplication(applicationId: string): Promise<string | null> {
  const { rows } = await pool.query<{ person_id: string }>(
    'SELECT person_id FROM application WHERE application_id = $1',
    [applicationId]
  );
  return rows[0]?.person_id ?? null;
}
