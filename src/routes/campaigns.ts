import { Router } from 'express';
import { requireLogin, sessionUser } from '../auth/middleware';
import { CAMPAIGN_STATUSES } from '../constants';
import { parseCampaignForm, parseQuestionBuilderForm } from './forms';
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  listCampaignQuestions,
  replaceCampaignQuestions,
  slugify,
} from '../campaigns/repository';
import { listQuestions } from '../questions/repository';
import { stagesForCampaign } from '../campaigns/stages';
import { applyUrl, sourceVariantLinks } from '../campaigns/links';

/**
 * Campaign CRUD, question builder, and source variant links.
 * Reachable by every login role (§4). Staff management stays Admin-only.
 */
export const campaignsRouter = Router();

campaignsRouter.use(requireLogin);

campaignsRouter.get('/', async (req, res, next) => {
  try {
    const campaigns = await listCampaigns();
    res.render('campaigns/list', { title: 'Campaigns', campaigns, user: sessionUser(req) });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.get('/new', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.render('campaigns/form', {
    title: 'New campaign',
    campaign: { status: 'open', positions_open: 1, opened_date: today, assignment_stage_enabled: false },
    statuses: CAMPAIGN_STATUSES,
    error: null,
    user: sessionUser(req),
  });
});

campaignsRouter.post('/new', async (req, res, next) => {
  try {
    const parsed = parseCampaignForm(req.body);
    if ('error' in parsed) {
      return res.status(400).render('campaigns/form', {
        title: 'New campaign',
        campaign: req.body,
        statuses: CAMPAIGN_STATUSES,
        error: parsed.error,
        user: sessionUser(req),
      });
    }
    if (!parsed.publicSlug) parsed.publicSlug = slugify(parsed.roleTitle);
    if (!parsed.openedDate) parsed.openedDate = new Date().toISOString().slice(0, 10);
    const campaign = await createCampaign(parsed);
    res.redirect(`/campaigns/${campaign.campaign_id}`);
  } catch (err) {
    next(err);
  }
});

campaignsRouter.get('/:campaignId', async (req, res, next) => {
  try {
    const campaign = await getCampaign(req.params.campaignId);
    if (!campaign) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    const attached = await listCampaignQuestions(campaign.campaign_id);
    const attachedIds = new Set(attached.map((q) => q.question_id));
    const bank = await listQuestions(true);
    const selectable = bank.filter((q) => q.active || attachedIds.has(q.question_id));
    res.render('campaigns/show', {
      title: campaign.role_title,
      campaign,
      attached,
      selectable,
      stages: stagesForCampaign(campaign),
      applyUrl: applyUrl(campaign.public_slug),
      sourceLinks: sourceVariantLinks(campaign.public_slug),
      user: sessionUser(req),
    });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.get('/:campaignId/edit', async (req, res, next) => {
  try {
    const campaign = await getCampaign(req.params.campaignId);
    if (!campaign) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    res.render('campaigns/form', {
      title: `Edit ${campaign.role_title}`,
      campaign,
      statuses: CAMPAIGN_STATUSES,
      error: null,
      user: sessionUser(req),
    });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.post('/:campaignId/edit', async (req, res, next) => {
  try {
    const campaign = await getCampaign(req.params.campaignId);
    if (!campaign) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    const parsed = parseCampaignForm(req.body);
    if ('error' in parsed) {
      return res.status(400).render('campaigns/form', {
        title: `Edit ${campaign.role_title}`,
        campaign: { ...campaign, ...req.body },
        statuses: CAMPAIGN_STATUSES,
        error: parsed.error,
        user: sessionUser(req),
      });
    }
    if (!parsed.publicSlug) parsed.publicSlug = slugify(parsed.roleTitle);
    await updateCampaign(campaign.campaign_id, parsed);
    res.redirect(`/campaigns/${campaign.campaign_id}`);
  } catch (err) {
    next(err);
  }
});

campaignsRouter.post('/:campaignId/questions', async (req, res, next) => {
  try {
    const campaign = await getCampaign(req.params.campaignId);
    if (!campaign) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    await replaceCampaignQuestions(campaign.campaign_id, parseQuestionBuilderForm(req.body));
    res.redirect(`/campaigns/${campaign.campaign_id}`);
  } catch (err) {
    next(err);
  }
});
