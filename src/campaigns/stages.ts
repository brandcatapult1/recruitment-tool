import { PIPELINE_STAGES, type PipelineStage } from '../constants';

/**
 * The stage list for one campaign — the single source of truth for which
 * stages exist on a campaign's pipeline (§6.1).
 *
 * `assignment` is the only conditional stage: when a campaign has
 * assignment_stage_enabled = false it is removed entirely, not hidden or
 * skipped over, so finance and HR roles pass straight from `screened` to
 * `interviewing`. M4's board reads this rather than the raw constant.
 */
export function stagesForCampaign(campaign: { assignment_stage_enabled: boolean }): PipelineStage[] {
  return PIPELINE_STAGES.filter(
    (stage) => stage !== 'assignment' || campaign.assignment_stage_enabled
  );
}

/** Whether a stage exists at all for a campaign. */
export function stageAppliesToCampaign(
  campaign: { assignment_stage_enabled: boolean },
  stage: PipelineStage
): boolean {
  return stagesForCampaign(campaign).includes(stage);
}
