import { NextResponse } from "next/server";
import {
  fetchHubspotProject,
  updateHubspotProjectStage,
} from "@/lib/hubspot";

const mapHubspotProject = (
  payload: Awaited<ReturnType<typeof fetchHubspotProject>>,
) => {
  const props = payload.properties ?? {};
  const stageId = props.hs_pipeline_stage ?? null;
  const rawStageLabel = props.hs_pipeline_stage_label;
  const stageLabel =
    typeof rawStageLabel === "string" ? rawStageLabel : null;
  return {
    id: payload.id,
    name: props.hs_name ?? props.projectname ?? props.name ?? null,
    stageId: stageId,
    stageLabel: typeof stageLabel === "string" ? stageLabel : null,
    stage: (typeof stageLabel === "string" ? stageLabel : null) || stageId,
    lastModified: props.hs_lastmodifieddate ?? null,
    raw: props,
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  if (!projectId) {
    return NextResponse.json(
      { error: "Missing HubSpot project ID." },
      { status: 400 },
    );
  }

  try {
    const project = await fetchHubspotProject(projectId);
    return NextResponse.json({ project: mapHubspotProject(project) });
  } catch (err: any) {
    console.error("HubSpot project fetch error", err);
    return NextResponse.json(
      { error: err?.message ?? "Unable to load HubSpot project." },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  if (!projectId) {
    return NextResponse.json(
      { error: "Missing HubSpot project ID." },
      { status: 400 },
    );
  }
  const body = await request.json().catch(() => null);
  const nextStage = body?.stage;
  if (!nextStage) {
    return NextResponse.json(
      { error: "Missing stage update payload." },
      { status: 400 },
    );
  }

  try {
    await updateHubspotProjectStage(projectId, nextStage);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("HubSpot stage update error", err);
    return NextResponse.json(
      { error: err?.message ?? "Unable to update HubSpot project." },
      { status: 500 },
    );
  }
}
