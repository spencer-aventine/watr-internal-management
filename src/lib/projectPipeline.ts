export type ProjectStatus = "reserved" | "wip" | "complete";

export const HUBSPOT_STAGE_NEW_ID =
  "acc364b5-d367-49f4-a957-cc4fbf7e8e4b";
export const HUBSPOT_STAGE_COMPLETE_ID = "3476494580";
const HUBSPOT_STAGE_WIP_ID =
  process.env.NEXT_PUBLIC_HUBSPOT_STAGE_WIP_ID ?? null;

export const describeProjectStatus = (status: ProjectStatus) => {
  switch (status) {
    case "reserved":
      return "Reserved";
    case "complete":
      return "Complete";
    default:
      return "WIP";
  }
};

export const describeHubspotStage = (stageId?: string | null) => {
  if (!stageId) return "Not synced";
  if (stageId === HUBSPOT_STAGE_NEW_ID) return "New";
  if (stageId === HUBSPOT_STAGE_COMPLETE_ID) return "Complete";
  return "WIP";
};

export const getProjectStatusFromStage = (
  stageId?: string | null,
): ProjectStatus => {
  if (stageId === HUBSPOT_STAGE_NEW_ID) return "reserved";
  if (stageId === HUBSPOT_STAGE_COMPLETE_ID) return "complete";
  return "wip";
};

export const getHubspotStageIdForStatus = (
  status: ProjectStatus,
): string | null => {
  if (status === "reserved") return HUBSPOT_STAGE_NEW_ID;
  if (status === "complete") return HUBSPOT_STAGE_COMPLETE_ID;
  return HUBSPOT_STAGE_WIP_ID || null;
};
