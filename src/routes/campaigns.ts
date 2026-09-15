import { Router } from 'express';
import { requireLogin, sessionUser } from '../auth/middleware';
import {
  CAMPAIGN_STATUSES,
  FREE_TEXT_QUESTION_TYPES,
  MAX_CAMPAIGN_APPLY_QUESTIONS,
  MAX_CAMPAIGN_FREE_TEXT_QUESTIONS,
  OUTCOME_REASONS,
  OUTCOME_REASON_LIST,
  PIPELINE_STAGES,
  TERMINAL_STAGES,
} from '../constants';
import { parseCampaignForm, parseQuestionBuilderForm } from './forms';
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  listCampaignQuestions,
  replaceCampaignQuestions,
  slugify,
  type CampaignRow,
} from '../campaigns/repository';
import { listActiveDepartments, getDepartment, listDepartmentQuestions } from '../departments/repository';
import { listBrands } from '../brands/repository';
import { isUserFacingError } from '../http/errors';
import { listQuestions } from '../questions/repository';
import { applyUrl, sourceVariantLinks } from '../campaigns/links';
import { setFlash } from '../http/flash';
import {
  listBoardCards,
  changeStage,
  changeOwner,
  cardAppliedBefore,
} from '../applications/repository';
import { listSelectableOwners } from '../staff/repository';

export const campaignsRouter = Router();

campaignsRouter.use(requireLogin);

async function formLocals(req: ExpressRequest, extras: Record<string, unknown>) {
  const departments = await listActiveDepartments();
  const campaign = extras.campaign as { department_id?: string } | undefined;
  if (campaign?.department_id && !departments.some((d) => d.department_id === campaign.department_id)) {
    const current = await getDepartment(campaign.department_id);
    if (current) departments.push(current);
  }
  return {
    statuses: CAMPAIGN_STATUSES,
    brands: await listBrands(false),
    departments,
    user: sessionUser(req),
    ...extras,
  };
}

type ExpressRequest = import('express').Request;

async function campaignShowLocals(req: ExpressRequest, campaign: CampaignRow, extras: Record<string, unknown> = {}) {
  const department = await getDepartment(campaign.department_id);
  const departmentQuestions = department
    ? await listDepartmentQuestions(department.department_id)
    : [];
  const attached = await listCampaignQuestions(campaign.campaign_id);
  const attachedIds = new Set(attached.map((q) => q.question_id));
  const bank = await listQuestions(true, campaign.brand_id);
  const selectable = bank.filter((q) => q.active || attachedIds.has(q.question_id));
  return {
    title: campaign.role_title,
    campaign,
    department,
    departmentQuestions,
    attached,
    selectable,
    stages: PIPELINE_STAGES,
    applyUrl: applyUrl(campaign.public_slug),
    sourceLinks: sourceVariantLinks(campaign.public_slug),
    freeTextTypes: FREE_TEXT_QUESTION_TYPES,
    maxCampaignQuestions: MAX_CAMPAIGN_APPLY_QUESTIONS,
    maxFreeText: MAX_CAMPAIGN_FREE_TEXT_QUESTIONS,
    user: sessionUser(req),
    error: null as string | null,
    ...extras,
  };
}

campaignsRouter.get('/', async (req, res, next) => {
  try {
    const raw = typeof req.query.brand === 'string' ? req.query.brand : '';
    const brandId = /^[0-9a-f-]{36}$/i.test(raw) ? raw : undefined;
    const [campaigns, brands] = await Promise.all([listCampaigns(brandId), listBrands(true)]);
    res.render('campaigns/list', {
      title: 'Campaigns',
      campaigns,
      brands,
      selectedBrand: brandId ?? '',
      user: sessionUser(req),
    });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.get('/new', async (req, res, next) => {
  try {
    res.render(
      'campaigns/form',
      await formLocals(req, {
        title: 'New campaign',
        mode: 'create',
        campaign: {
          positions_open: 1,
          show_salary_publicly: true,
        },
        error: null,
      })
    );
  } catch (err) {
    next(err);
  }
});

campaignsRouter.post('/new', async (req, res, next) => {
  try {
    const parsed = parseCampaignForm(req.body, 'create');
    if ('error' in parsed) {
      return res.status(400).render(
        'campaigns/form',
        await formLocals(req, {
          title: 'New campaign',
          mode: 'create',
          campaign: req.body,
          error: parsed.error,
        })
      );
    }
    if (!parsed.publicSlug) parsed.publicSlug = slugify(parsed.roleTitle);
    try {
      const campaign = await createCampaign({
        ...parsed,
        openedDate: new Date().toISOString().slice(0, 10),
      });
      res.redirect(`/campaigns/${campaign.campaign_id}`);
    } catch (err) {
      if (!isUserFacingError(err)) throw err;
      return res.status(400).render(
        'campaigns/form',
        await formLocals(req, {
          title: 'New campaign',
          mode: 'create',
          campaign: req.body,
          error: err.message,
        })
      );
    }
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
    res.render('campaigns/show', await campaignShowLocals(req, campaign));
  } catch (err) {
    next(err);
  }
});

campaignsRouter.get('/:campaignId/board', async (req, res, next) => {
  try {
    const campaign = await getCampaign(req.params.campaignId);
    if (!campaign) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    const requestedBrand =
      typeof req.query.brand === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.brand)
        ? req.query.brand
        : undefined;
    const brandFilter = requestedBrand ?? campaign.brand_id;
    const brandCampaigns = await listCampaigns(brandFilter);
    if (requestedBrand && requestedBrand !== campaign.brand_id) {
      const first = brandCampaigns[0];
      if (first) {
        return res.redirect(`/campaigns/${first.campaign_id}/board?brand=${requestedBrand}`);
      }
    }
    const [cards, owners, brands] = await Promise.all([
      listBoardCards(campaign.campaign_id),
      listSelectableOwners(),
      listBrands(true),
    ]);
    const columns = PIPELINE_STAGES.map((stage) => ({
      stage,
      cards: cards.filter((c) => c.stage === stage),
    }));
    const terminalCards = cards.filter((c) =>
      (TERMINAL_STAGES as readonly string[]).includes(c.stage)
    );
    const ours = OUTCOME_REASON_LIST.filter((r) => OUTCOME_REASONS[r] === 'ours');
    const theirs = OUTCOME_REASON_LIST.filter((r) => OUTCOME_REASONS[r] === 'theirs');
    res.render('campaigns/board', {
      title: `${campaign.role_title} · Board`,
      campaign,
      columns,
      terminalCards,
      owners,
      brands,
      brandCampaigns,
      selectedBrand: brandFilter,
      pipelineStages: PIPELINE_STAGES,
      terminalStages: TERMINAL_STAGES,
      outcomeOurs: ours,
      outcomeTheirs: theirs,
      cardAppliedBefore,
      user: sessionUser(req),
      error: null as string | null,
    });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.post('/:campaignId/applications/:applicationId/stage', async (req, res, next) => {
  try {
    const user = sessionUser(req);
    if (!user) return res.redirect('/login');
    const campaign = await getCampaign(req.params.campaignId);
    if (!campaign) {
      return res.status(404).render('not-found', { title: 'Not found', user });
    }
    try {
      await changeStage(
        campaign.campaign_id,
        req.params.applicationId,
        String(req.body.stage ?? ''),
        req.body.outcome_reason == null ? null : String(req.body.outcome_reason),
        user.staffId
      );
    } catch (err) {
      if (!isUserFacingError(err)) throw err;
      setFlash(req, { type: 'error', message: err.message });
      return req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.redirect(`/campaigns/${campaign.campaign_id}/board`);
      });
    }
    res.redirect(`/campaigns/${campaign.campaign_id}/board`);
  } catch (err) {
    next(err);
  }
});

campaignsRouter.post('/:campaignId/applications/:applicationId/owner', async (req, res, next) => {
  try {
    const user = sessionUser(req);
    if (!user) return res.redirect('/login');
    const campaign = await getCampaign(req.params.campaignId);
    if (!campaign) {
      return res.status(404).render('not-found', { title: 'Not found', user });
    }
    const raw = String(req.body.owner_staff_id ?? '').trim();
    try {
      await changeOwner(
        campaign.campaign_id,
        req.params.applicationId,
        raw || null,
        user.staffId
      );
    } catch (err) {
      if (!isUserFacingError(err)) throw err;
      setFlash(req, { type: 'error', message: err.message });
      return req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.redirect(`/campaigns/${campaign.campaign_id}/board`);
      });
    }
    res.redirect(`/campaigns/${campaign.campaign_id}/board`);
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
    res.render(
      'campaigns/form',
      await formLocals(req, {
        title: `Edit ${campaign.role_title}`,
        mode: 'edit',
        campaign,
        error: null,
      })
    );
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
    const parsed = parseCampaignForm(req.body, 'edit');
    if ('error' in parsed) {
      return res.status(400).render(
        'campaigns/form',
        await formLocals(req, {
          title: `Edit ${campaign.role_title}`,
          mode: 'edit',
          campaign: { ...campaign, ...req.body },
          error: parsed.error,
        })
      );
    }
    if (!parsed.publicSlug) parsed.publicSlug = campaign.public_slug;
    try {
      await updateCampaign(
        campaign.campaign_id,
        { ...parsed, brandId: campaign.brand_id, openedDate: campaign.opened_date },
        campaign.status
      );
    } catch (err) {
      if (!isUserFacingError(err)) throw err;
      return res.status(400).render(
        'campaigns/form',
        await formLocals(req, {
          title: `Edit ${campaign.role_title}`,
          mode: 'edit',
          campaign: { ...campaign, ...req.body, brand_id: campaign.brand_id },
          error: err.message,
        })
      );
    }
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
    try {
      await replaceCampaignQuestions(campaign.campaign_id, parseQuestionBuilderForm(req.body));
    } catch (err) {
      if (!isUserFacingError(err)) throw err;
      return res.status(400).render(
        'campaigns/show',
        await campaignShowLocals(req, campaign, { error: err.message })
      );
    }
    setFlash(req, { type: 'success', message: 'Questions saved.' });
    req.session.save((saveErr) => {
      if (saveErr) return next(saveErr);
      res.redirect(`/campaigns/${campaign.campaign_id}`);
    });
  } catch (err) {
    next(err);
  }
});
