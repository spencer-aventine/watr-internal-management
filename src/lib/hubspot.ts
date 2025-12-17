const HUBSPOT_BASE_URL = "https://api.hubapi.com";
const HUBSPOT_PROJECT_FIELDS = [
  "hs_name",
  "hs_pipeline_stage",
  "hs_pipeline_stage_label",
  "hs_lastmodifieddate",
];

export type HubspotProjectResponse = {
  id: string;
  properties: Record<string, unknown>;
};

export const fetchHubspotProject = async (projectId: string) => {
  const accessToken = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!accessToken) {
    throw new Error(
      "Missing HUBSPOT_PRIVATE_APP_TOKEN. Set it in your environment variables.",
    );
  }

  const url = new URL(
    `${HUBSPOT_BASE_URL}/crm/v3/objects/projects/${encodeURIComponent(projectId)}`,
  );
  url.searchParams.set("properties", HUBSPOT_PROJECT_FIELDS.join(","));

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `HubSpot API error (${response.status}): ${text || response.statusText}`,
    );
  }

  return (await response.json()) as HubspotProjectResponse;
};

export const updateHubspotProjectStage = async (
  projectId: string,
  stageId: string,
) => {
  const accessToken = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!accessToken) {
    throw new Error(
      "Missing HUBSPOT_PRIVATE_APP_TOKEN. Set it in your environment variables.",
    );
  }

  const url = `${HUBSPOT_BASE_URL}/crm/v3/objects/projects/${encodeURIComponent(projectId)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        hs_pipeline_stage: stageId,
      },
    }),
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `HubSpot API error (${response.status}): ${text || response.statusText}`,
    );
  }
};
