// src/app/projects/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  doc,
  getDoc,
  Timestamp,
  writeBatch,
  increment,
} from "firebase/firestore";
import {
  ProjectItemLine,
  ProjectItemsByType,
  PROJECT_ITEM_LABELS,
  parseProjectItems,
  flattenProjectItems,
} from "../_projectItemUtils";

type Project = {
  id: string;
  name: string;
  status: "wip" | "complete";
  hubspotDealId?: string | null;
  items: ProjectItemLine[];
  itemsByType: ProjectItemsByType;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
};

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [subAssemblyComponents, setSubAssemblyComponents] = useState<
    Record<
      string,
      {
        componentId: string;
        name: string;
        sku?: string | null;
        quantityPerAssembly: number;
      }[]
    >
  >({});
  const [sensorExtrasBySensor, setSensorExtrasBySensor] = useState<
    Record<
      string,
      {
        sensorExtraId: string;
        name: string;
        sku?: string | null;
      }[]
    >
  >({});
  const [hubspotData, setHubspotData] = useState<{
    id: string;
    name: string | null;
    stageId: string | null;
    stageLabel: string | null;
    lastModified: string | null;
  } | null>(null);
  const [hubspotLoading, setHubspotLoading] = useState(false);
  const [hubspotError, setHubspotError] = useState<string | null>(null);

  const loadProject = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const ref = doc(db, "projects", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        setError("Project not found.");
        setProject(null);
        return;
      }
      const data = snap.data() as any;

      const structuredItems = parseProjectItems(data);
      const flattenedItems = flattenProjectItems(structuredItems);
      const proj: Project = {
        id: snap.id,
        name: data.name ?? "",
        status: (data.status as "wip" | "complete") ?? "wip",
        hubspotDealId: data.hubspotDealId ?? null,
        items: flattenedItems,
        itemsByType: structuredItems,
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
      };

      setProject(proj);
      setHubspotData(null);
      setHubspotError(null);
    } catch (err: any) {
      console.error("Error loading project", err);
      setError(err?.message ?? "Error loading project");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const subAssemblies = project?.itemsByType.subAssemblies ?? [];
    if (!subAssemblies.length) {
      setSubAssemblyComponents({});
      return;
    }
    const uniqueIds = Array.from(
      new Set(subAssemblies.map((line) => line.itemId).filter(Boolean)),
    );
    let cancelled = false;
    const loadComponents = async () => {
      try {
        const entries = await Promise.all(
          uniqueIds.map(async (subAssemblyId) => {
            if (!subAssemblyId) return null;
            try {
              const ref = doc(db, "items", subAssemblyId);
              const snap = await getDoc(ref);
              if (!snap.exists()) return { id: subAssemblyId, components: [] };
              const data = snap.data() as any;
              const components = Array.isArray(data.components)
                ? data.components
                    .map((component: any) => {
                      const componentId =
                        component.componentId ??
                        component.itemId ??
                        component.id ??
                        component.referenceId ??
                        null;
                      if (!componentId) return null;
                      const perAssembly = Number(
                        component.quantity ?? component.qty ?? 0,
                      );
                      if (!Number.isFinite(perAssembly) || perAssembly <= 0) {
                        return null;
                      }
                      return {
                        componentId: String(componentId),
                        name:
                          component.name ??
                          component.componentName ??
                          component.itemName ??
                          component.sku ??
                          "Component",
                        sku: component.sku ?? component.code ?? null,
                        quantityPerAssembly: perAssembly,
                      };
                    })
                    .filter((item: any): item is {
                      componentId: string;
                      name: string;
                      sku?: string | null;
                      quantityPerAssembly: number;
                    } => Boolean(item))
                : [];
              return { id: subAssemblyId, components };
            } catch (err) {
              console.error("Error loading sub-assembly components", err);
              return { id: subAssemblyId, components: [] };
            }
          }),
        );
        if (cancelled) return;
        const componentIds = new Set<string>();
        entries.forEach((entry) => {
          entry?.components?.forEach((component) => {
            componentIds.add(component.componentId);
          });
        });
        const directory: Record<
          string,
          { name: string; sku?: string | null }
        > = {};
        if (componentIds.size) {
          const records = await Promise.all(
            Array.from(componentIds).map(async (componentId) => {
              try {
                const ref = doc(db, "items", componentId);
                const snap = await getDoc(ref);
                if (!snap.exists()) return null;
                const data = snap.data() as any;
                return {
                  id: componentId,
                  name: data.name ?? data.sku ?? "Component",
                  sku: data.sku ?? data.shortCode ?? null,
                };
              } catch (err) {
                console.error("Error loading component detail", err);
                return null;
              }
            }),
          );
          records.forEach((record) => {
            if (!record) return;
            directory[record.id] = {
              name: record.name,
              sku: record.sku,
            };
          });
        }
        const map: Record<
          string,
          {
            componentId: string;
            name: string;
            sku?: string | null;
            quantityPerAssembly: number;
          }[]
        > = {};
        entries.forEach((entry) => {
          if (!entry) return;
          map[entry.id] = entry.components.map((component) => {
            const override = directory[component.componentId];
            return override
              ? {
                  ...component,
                  name: override.name,
                  sku: override.sku ?? component.sku,
                }
              : component;
          });
        });
        setSubAssemblyComponents(map);
      } catch (err) {
        console.error("Error loading sub-assembly component map", err);
      }
    };
    loadComponents();
    return () => {
      cancelled = true;
    };
  }, [project?.itemsByType.subAssemblies]);

  useEffect(() => {
    const sensors = project?.itemsByType.sensors ?? [];
    if (!sensors.length) {
      setSensorExtrasBySensor({});
      return;
    }
    const uniqueIds = Array.from(
      new Set(sensors.map((line) => line.itemId).filter(Boolean)),
    );
    let cancelled = false;
    const loadSensorExtras = async () => {
      try {
        const entries = await Promise.all(
          uniqueIds.map(async (sensorId) => {
            if (!sensorId) return null;
            try {
              const ref = doc(db, "items", sensorId);
              const snap = await getDoc(ref);
              if (!snap.exists()) return { id: sensorId, extras: [] };
              const data = snap.data() as any;
              const extras = Array.isArray(data.mandatorySensorExtras)
                ? data.mandatorySensorExtras
                    .map((extra: any) => {
                      const extraId =
                        extra.sensorExtraId ??
                        extra.itemId ??
                        extra.id ??
                        extra.referenceId ??
                        null;
                      if (!extraId) return null;
                      return {
                        sensorExtraId: String(extraId),
                        name: extra.name ?? extra.sku ?? "Sensor extra",
                        sku: extra.sku ?? null,
                      };
                    })
                    .filter(
                      (item: any): item is {
                        sensorExtraId: string;
                        name: string;
                        sku?: string | null;
                      } => Boolean(item),
                    )
                : [];
              return { id: sensorId, extras };
            } catch (err) {
              console.error("Error loading sensor extras", err);
              return { id: sensorId, extras: [] };
            }
          }),
        );
        if (cancelled) return;
        const map: Record<
          string,
          {
            sensorExtraId: string;
            name: string;
            sku?: string | null;
          }[]
        > = {};
        entries.forEach((entry) => {
          if (!entry) return;
          map[entry.id] = entry.extras;
        });
        setSensorExtrasBySensor(map);
      } catch (err) {
        console.error("Error loading sensor extras map", err);
      }
    };
    loadSensorExtras();
    return () => {
      cancelled = true;
    };
  }, [project?.itemsByType.sensors]);

  const handleChangeStatus = async (targetStatus: "wip" | "complete") => {
    if (!project) return;
    if (project.status === targetStatus) return;

    setMoving(true);
    setError(null);
    setMessage(null);

    try {
      const now = Timestamp.now();
      const batch = writeBatch(db);

      const projRef = doc(db, "projects", project.id);
      batch.update(projRef, {
        status: targetStatus,
        updatedAt: now,
      });

      const isToComplete = targetStatus === "complete";

      project.items.forEach((line) => {
        const qty = line.qty || 0;
        if (!line.itemId || !qty) return;

        const itemRef = doc(db, "items", line.itemId);
        const wipDelta = isToComplete ? -qty : qty;
        const completedDelta = isToComplete ? qty : -qty;

        batch.update(itemRef, {
          wipQty: increment(wipDelta),
          completedQty: increment(completedDelta),
          updatedAt: now,
        });

        if (line.mustHaveItemId && line.mustHaveQty && line.mustHaveQty > 0) {
          const mQty = line.mustHaveQty;
          const mustRef = doc(db, "items", line.mustHaveItemId);
          const mWipDelta = isToComplete ? -mQty : mQty;
          const mCompletedDelta = isToComplete ? mQty : -mQty;

          batch.update(mustRef, {
            wipQty: increment(mWipDelta),
            completedQty: increment(mCompletedDelta),
            updatedAt: now,
          });
        }
      });

      await batch.commit();
      setMessage("Project status and stock updated.");
      // refresh local state
      await loadProject();
    } catch (err: any) {
      console.error("Error updating project status", err);
      setError(err?.message ?? "Error updating project status");
    } finally {
      setMoving(false);
    }
  };

  const handleLoadHubspotData = async () => {
    if (!project?.hubspotDealId) return;
    setHubspotLoading(true);
    setHubspotError(null);
    try {
      const response = await fetch(
        `/api/hubspot/projects/${encodeURIComponent(project.hubspotDealId)}`,
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || response.statusText);
      }
      const payload = await response.json();
      setHubspotData(payload.project);
    } catch (err: any) {
      console.error("Error loading HubSpot data", err);
      setHubspotError(err?.message ?? "Unable to load HubSpot project data.");
    } finally {
      setHubspotLoading(false);
    }
  };

  const formatDate = (ts?: Timestamp | null) => {
    if (!ts) return "—";
    try {
      return ts.toDate().toLocaleString();
    } catch {
      return "—";
    }
  };

  const statusTag = project?.status === "complete" ? (
    <span className="ims-status-tag ims-status-tag--active">
      Complete
    </span>
  ) : (
    <span className="ims-status-tag ims-status-tag--inactive">
      WIP
    </span>
  );

  return (
    <main className="ims-content">
      {loading ? (
        <p>Loading project…</p>
      ) : error ? (
        <>
          <button
            type="button"
            className="ims-secondary-button"
            onClick={() => router.push("/projects")}
          >
            ← Back to board
          </button>
          <p className="ims-form-error" style={{ marginTop: "0.75rem" }}>
            {error}
          </p>
        </>
      ) : !project ? (
        <>
          <button
            type="button"
            className="ims-secondary-button"
            onClick={() => router.push("/projects")}
          >
            ← Back to board
          </button>
          <p className="ims-form-error" style={{ marginTop: "0.75rem" }}>
            Project not found.
          </p>
        </>
      ) : (
        <>
          <section className="ims-page-header ims-page-header--with-actions">
            <div>
              <h1 className="ims-page-title">{project.name}</h1>
              <p className="ims-page-subtitle">
                Full project view. Moving between WIP and Complete will update
                WIP and completed stock counts on the linked products.
              </p>
            </div>
            <div className="ims-page-actions">
              {statusTag}
              <button
                type="button"
                className="ims-secondary-button"
                onClick={() => router.push("/projects")}
              >
                ← Back to board
              </button>
              {project.status === "wip" ? (
                <button
                  type="button"
                  className="ims-primary-button"
                  disabled={moving}
                  onClick={() => handleChangeStatus("complete")}
                >
                  {moving ? "Updating…" : "Mark as complete"}
                </button>
              ) : (
                <button
                  type="button"
                  className="ims-primary-button"
                  disabled={moving}
                  onClick={() => handleChangeStatus("wip")}
                >
                  {moving ? "Updating…" : "Move back to WIP"}
                </button>
              )}
            </div>
          </section>

          {(message || error) && (
            <div
              className={
                "ims-alert " +
                (error ? "ims-alert--error" : "ims-alert--info")
              }
            >
              {error || message}
            </div>
          )}

          {/* Summary card */}
          <section className="card ims-form-section" style={{ marginBottom: "1rem" }}>
            <h2 className="ims-form-section-title">Project summary</h2>
            <p className="ims-form-section-subtitle">
              Key identifiers and integration references.
            </p>

            <div className="ims-field-row">
              <div className="ims-field">
                <span className="ims-field-label">Project name</span>
                <div>{project.name || "—"}</div>
              </div>
              <div className="ims-field">
                <span className="ims-field-label">Status</span>
                <div>{statusTag}</div>
              </div>
            </div>

            <div className="ims-field-row">
              <div className="ims-field">
                <span className="ims-field-label">HubSpot Project ID</span>
                <div>{project.hubspotDealId || "—"}</div>
              </div>
              <div className="ims-field">
                <span className="ims-field-label">Created</span>
                <div>{formatDate(project.createdAt)}</div>
              </div>
            </div>

            <div className="ims-field">
              <span className="ims-field-label">Last updated</span>
              <div>{formatDate(project.updatedAt)}</div>
            </div>
          </section>
          {project.hubspotDealId && (
            <section className="card ims-form-section" style={{ marginBottom: "1rem" }}>
              <div className="ims-table-header">
                <div>
                  <h2 className="ims-form-section-title">HubSpot project</h2>
                  <p className="ims-form-section-subtitle">
                    Sync the linked HubSpot record for live stage and amount data.
                  </p>
                </div>
                <div className="ims-page-actions">
                  <button
                    type="button"
                    className="ims-secondary-button"
                    onClick={handleLoadHubspotData}
                    disabled={hubspotLoading}
                  >
                    {hubspotLoading ? "Loading…" : "Sync from HubSpot"}
                  </button>
                </div>
              </div>
              {hubspotError && (
                <div
                  className="ims-alert ims-alert--error"
                  style={{ marginBottom: "0.75rem" }}
                >
                  {hubspotError}
                </div>
              )}
              {hubspotData ? (
                <div className="ims-field-grid">
                  <div className="ims-field">
                    <span className="ims-field-label">Project name</span>
                    <div>{hubspotData.name || "—"}</div>
                  </div>
                  <div className="ims-field">
                    <span className="ims-field-label">Pipeline stage</span>
                    <div>
                      {hubspotData.stageLabel ||
                        hubspotData.stageId ||
                        "—"}
                    </div>
                  </div>
                  <div className="ims-field">
                    <span className="ims-field-label">Last modified</span>
                    <div>{hubspotData.lastModified || "—"}</div>
                  </div>
                </div>
              ) : (
                <p className="ims-table-empty">
                  Sync the HubSpot project data to view the latest information.
                </p>
              )}
            </section>
          )}

          {/* Products */}
          <section className="card ims-table-card">
            <div className="ims-table-header">
              <h2 className="ims-form-section-title">Products</h2>
              <span className="ims-table-count">
                {project.itemsByType.products.length} product
                {project.itemsByType.products.length === 1 ? "" : "s"}
              </span>
            </div>

            {project.itemsByType.products.length === 0 ? (
              <p className="ims-table-empty">
                No products linked to this project.
              </p>
            ) : (
              <div className="ims-table-wrapper">
                <table className="ims-table ims-table--compact">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Quantity</th>
                      <th>Must-have product</th>
                      <th>Must-have quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.itemsByType.products.map((line) => (
                      <tr key={line.itemId}>
                        <td>{line.itemName}</td>
                        <td>{line.qty}</td>
                        <td>{line.mustHaveItemName || "—"}</td>
                        <td>
                          {line.mustHaveItemName && line.mustHaveQty
                            ? line.mustHaveQty
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Sub-assemblies */}
          <section className="card ims-table-card">
            <div className="ims-table-header">
              <h2 className="ims-form-section-title">Sub-assemblies</h2>
              <span className="ims-table-count">
                {project.itemsByType.subAssemblies.length} sub-assembly
                {project.itemsByType.subAssemblies.length === 1 ? "" : "ies"}
              </span>
            </div>
            {project.itemsByType.subAssemblies.length === 0 ? (
              <p className="ims-table-empty">
                No sub-assemblies linked to this project.
              </p>
            ) : (
              <div className="ims-table-wrapper">
                <table className="ims-table ims-table--compact">
                  <thead>
                    <tr>
                      <th>Sub-assembly</th>
                      <th>Quantity</th>
                      <th>Components required</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.itemsByType.subAssemblies.map((line) => {
                      const components =
                        subAssemblyComponents[line.itemId] ?? [];
                      return (
                        <tr key={line.itemId}>
                          <td>{line.itemName}</td>
                          <td>{line.qty}</td>
                          <td>
                            {components.length === 0 ? (
                              <span className="ims-table-empty">
                                Components not defined for this assembly.
                              </span>
                            ) : (
                              <ul className="ims-list">
                                {components.map((component) => {
                                  const totalRequired =
                                    component.quantityPerAssembly *
                                    (line.qty || 0);
                                  return (
                                    <li key={component.componentId}>
                                      <div style={{ fontWeight: 600 }}>
                                        {totalRequired} × {component.name}
                                      </div>
                                      <div
                                        style={{
                                          fontSize: "0.8rem",
                                          color: "#6b7280",
                                        }}
                                      >
                                        {component.quantityPerAssembly} per
                                        sub-assembly
                                        {component.sku
                                          ? ` · ${component.sku}`
                                          : ""}
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Components */}
          <section className="card ims-table-card">
            <div className="ims-table-header">
              <h2 className="ims-form-section-title">Loose components</h2>
              <span className="ims-table-count">
                {project.itemsByType.components.length} component
                {project.itemsByType.components.length === 1 ? "" : "s"}
              </span>
            </div>
            {project.itemsByType.components.length === 0 ? (
              <p className="ims-table-empty">
                No standalone components linked to this project.
              </p>
            ) : (
              <div className="ims-table-wrapper">
                <table className="ims-table ims-table--compact">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th>Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.itemsByType.components.map((line) => (
                      <tr key={line.itemId}>
                        <td>{line.itemName}</td>
                        <td>{line.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Sensors */}
          <section className="card ims-table-card">
            <div className="ims-table-header">
              <h2 className="ims-form-section-title">Sensors</h2>
              <span className="ims-table-count">
                {project.itemsByType.sensors.length} sensor
                {project.itemsByType.sensors.length === 1 ? "" : "s"}
              </span>
            </div>
            {project.itemsByType.sensors.length === 0 ? (
              <p className="ims-table-empty">
                No sensors linked to this project.
              </p>
            ) : (
              <div className="ims-table-wrapper">
                <table className="ims-table ims-table--compact">
                  <thead>
                    <tr>
                      <th>Sensor</th>
                      <th>Quantity</th>
                      <th>Sensor extras required</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.itemsByType.sensors.map((line) => {
                      const extras = sensorExtrasBySensor[line.itemId] ?? [];
                      return (
                        <tr key={line.itemId}>
                          <td>{line.itemName}</td>
                          <td>{line.qty}</td>
                          <td>
                            {extras.length === 0 ? (
                              <span className="ims-table-empty">
                                No mandatory extras defined for this sensor.
                              </span>
                            ) : (
                              <ul className="ims-list">
                                {extras.map((extra) => (
                                  <li key={extra.sensorExtraId}>
                                    <div style={{ fontWeight: 600 }}>
                                      {line.qty} × {extra.name}
                                    </div>
                                    {extra.sku && (
                                      <div
                                        style={{
                                          fontSize: "0.8rem",
                                          color: "#6b7280",
                                        }}
                                      >
                                        {extra.sku}
                                      </div>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
