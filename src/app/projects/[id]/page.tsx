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

type ProjectItemLine = {
  itemId: string;
  itemName: string;
  qty: number;
  mustHaveItemId?: string | null;
  mustHaveItemName?: string | null;
  mustHaveQty?: number | null;
};

type Project = {
  id: string;
  name: string;
  status: "wip" | "complete";
  hubspotDealId?: string | null;
  items: ProjectItemLine[];
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

      const proj: Project = {
        id: snap.id,
        name: data.name ?? "",
        status: (data.status as "wip" | "complete") ?? "wip",
        hubspotDealId: data.hubspotDealId ?? null,
        items: Array.isArray(data.items)
          ? data.items.map((it: any) => ({
              itemId: it.itemId,
              itemName: it.itemName,
              qty: Number(it.qty) || 0,
              mustHaveItemId:
                typeof it.mustHaveItemId === "string"
                  ? it.mustHaveItemId
                  : null,
              mustHaveItemName:
                typeof it.mustHaveItemName === "string"
                  ? it.mustHaveItemName
                  : null,
              mustHaveQty:
                typeof it.mustHaveQty === "number" ? it.mustHaveQty : null,
            }))
          : [],
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
      };

      setProject(proj);
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
                <span className="ims-field-label">HubSpot deal ID</span>
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

          {/* Products table */}
          <section className="card ims-table-card">
            <div className="ims-table-header">
              <h2 className="ims-form-section-title">Products in project</h2>
              <span className="ims-table-count">
                {project.items.length} product
                {project.items.length === 1 ? "" : "s"}
              </span>
            </div>

            {project.items.length === 0 ? (
              <p className="ims-table-empty">
                No products linked to this project.
              </p>
            ) : (
              <div className="ims-table-wrapper">
                <table className="ims-table ims-table--compact">
                  <thead>
                    <tr>
                      <th>Main product</th>
                      <th>Quantity</th>
                      <th>Must-have product</th>
                      <th>Must-have quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.items.map((line, idx) => (
                      <tr key={idx}>
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
        </>
      )}
    </main>
  );
}
