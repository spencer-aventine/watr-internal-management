// src/app/projects/page.tsx
"use client";

import {
  useEffect,
  useState,
  type KeyboardEvent,
  type DragEvent,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
  query,
  orderBy,
  Timestamp,
  writeBatch,
  increment,
} from "firebase/firestore";
import { createOrUpdateProductTracking } from "@/lib/productTracking";
import {
  ProjectItemCategory,
  PROJECT_ITEM_LABELS,
  ProjectItemLine,
  ProjectItemsByType,
  parseProjectItems,
  flattenProjectItems,
} from "./_projectItemUtils";

type ProjectStatus = "reserved" | "wip" | "complete";

type Project = {
  id: string;
  name: string;
  status: ProjectStatus;
  hubspotDealId?: string | null;
  items: ProjectItemLine[];
  itemsByType: ProjectItemsByType;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  completedAt?: Timestamp | null;
};


export default function ProjectsWipPage() {
  const router = useRouter();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Search (by name or HubSpot project ID)
  const [search, setSearch] = useState("");

  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<
    ProjectStatus | null
  >(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load projects
      const projectsSnap = await getDocs(
        query(collection(db, "projects"), orderBy("createdAt", "desc")),
      );
      const projRows: Project[] = projectsSnap.docs.map((d) => {
        const data = d.data() as any;
        const structuredItems = parseProjectItems(data);
        const flattenedItems = flattenProjectItems(structuredItems);
        return {
          id: d.id,
          name: data.name ?? "",
          status: (data.status as ProjectStatus) ?? "reserved",
          hubspotDealId: data.hubspotDealId ?? null,
          items: flattenedItems,
          itemsByType: structuredItems,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          completedAt: data.completedAt ?? null,
        };
      });
      setProjects(projRows);
    } catch (err: any) {
      console.error("Error loading WIP data", err);
      setError(err?.message ?? "Error loading WIP data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const createProductTrackingRecords = async (
    project: Project,
    completedAt: Timestamp,
  ) => {
    await Promise.all(
      project.items.map(async (line) => {
        if (!line.itemId) return;
        await createOrUpdateProductTracking(
          project,
          line.itemId,
          line.itemName,
          line.qty || 0,
          completedAt,
          line.itemType,
        );
      }),
    );
  };
  /**
   * Move project between Reserved / WIP / Complete.
   *
   * Inventory:
   *  - Only changes on creation (inventory → reserved).
   *
   * Stock bucket transitions:
   *  reserved → wip:       reserved--, wip++
   *  wip → complete:       wip--, completed++
   *  reserved → complete:  reserved--, completed++
   *  wip → reserved:       wip--, reserved++
   *  complete → wip:       completed--, wip++
   *  complete → reserved:  completed--, reserved++
   */
  const handleMoveProject = async (
    project: Project,
    targetStatus: ProjectStatus,
  ) => {
    if (project.status === targetStatus) return;

    const fromStatus = project.status;

    setMoving(project.id);
    setError(null);
    setMessage(null);

    try {
      const now = Timestamp.now();
      const batch = writeBatch(db);
      const shouldTrackCompletion =
        targetStatus === "complete" && fromStatus !== "complete";

      // Update project status
      const projRef = doc(db, "projects", project.id);
      const projectUpdates: any = {
        status: targetStatus,
        updatedAt: now,
      };
      if (targetStatus === "complete") {
        projectUpdates.completedAt = now;
      } else if (fromStatus === "complete") {
        projectUpdates.completedAt = null;
      }
      batch.update(projRef, projectUpdates);

      const computeDeltas = (qty: number) => {
        let reservedDelta = 0;
        let wipDelta = 0;
        let completedDelta = 0;

        if (fromStatus === "reserved" && targetStatus === "wip") {
          reservedDelta = -qty;
          wipDelta = +qty;
        } else if (fromStatus === "wip" && targetStatus === "complete") {
          wipDelta = -qty;
          completedDelta = +qty;
        } else if (
          fromStatus === "reserved" &&
          targetStatus === "complete"
        ) {
          reservedDelta = -qty;
          completedDelta = +qty;
        } else if (
          fromStatus === "wip" &&
          targetStatus === "reserved"
        ) {
          wipDelta = -qty;
          reservedDelta = +qty;
        } else if (
          fromStatus === "complete" &&
          targetStatus === "wip"
        ) {
          completedDelta = -qty;
          wipDelta = +qty;
        } else if (
          fromStatus === "complete" &&
          targetStatus === "reserved"
        ) {
          completedDelta = -qty;
          reservedDelta = +qty;
        }

        return { reservedDelta, wipDelta, completedDelta };
      };

      project.items.forEach((line) => {
        const qty = line.qty || 0;
        if (!line.itemId || !qty) return;

        const { reservedDelta, wipDelta, completedDelta } =
          computeDeltas(qty);

        if (
          reservedDelta === 0 &&
          wipDelta === 0 &&
          completedDelta === 0
        ) {
          return;
        }

        const itemRef = doc(db, "items", line.itemId);
        const updates: any = { updatedAt: now };

        if (reservedDelta) {
          updates.reservedQty = increment(reservedDelta);
        }
        if (wipDelta) {
          updates.wipQty = increment(wipDelta);
        }
        if (completedDelta) {
          updates.completedQty = increment(completedDelta);
        }

        batch.update(itemRef, updates);

        if (line.mustHaveItemId && line.mustHaveQty && line.mustHaveQty > 0) {
          const mQty = line.mustHaveQty;
          const mDeltas = computeDeltas(mQty);
          if (
            mDeltas.reservedDelta === 0 &&
            mDeltas.wipDelta === 0 &&
            mDeltas.completedDelta === 0
          ) {
            return;
          }

          const mustRef = doc(db, "items", line.mustHaveItemId);
          const mUpdates: any = { updatedAt: now };

          if (mDeltas.reservedDelta) {
            mUpdates.reservedQty = increment(mDeltas.reservedDelta);
          }
          if (mDeltas.wipDelta) {
            mUpdates.wipQty = increment(mDeltas.wipDelta);
          }
          if (mDeltas.completedDelta) {
            mUpdates.completedQty = increment(mDeltas.completedDelta);
          }

          batch.update(mustRef, mUpdates);
        }
      });

      await batch.commit();
      if (shouldTrackCompletion) {
        await createProductTrackingRecords(project, now);
      }
      setMessage("Project status changed and stock buckets updated.");
      await loadData();
    } catch (err: any) {
      console.error("Error moving project", err);
      setError(err?.message ?? "Error updating project status");
    } finally {
      setMoving(null);
    }
  };

  const handleCardClick = (projectId: string) => {
    // Avoid navigation while a drag is in progress
    if (draggingId) return;
    router.push(`/projects/${projectId}`);
  };

  const handleCardKeyDown = (
    e: KeyboardEvent<HTMLElement>,
    projectId: string,
  ) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      router.push(`/projects/${projectId}`);
    }
  };

  // Drag handlers
  const handleCardDragStart = (e: DragEvent<HTMLElement>, projectId: string) => {
    setDraggingId(projectId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleCardDragEnd = () => {
    setDraggingId(null);
    setDragOverColumn(null);
  };

  const handleColumnDragOver = (
    e: DragEvent<HTMLDivElement>,
    status: ProjectStatus,
  ) => {
    e.preventDefault();
    if (dragOverColumn !== status) {
      setDragOverColumn(status);
    }
    e.dataTransfer.dropEffect = "move";
  };

  const handleColumnDragLeave = (
    _e: DragEvent<HTMLDivElement>,
    status: ProjectStatus,
  ) => {
    if (dragOverColumn === status) {
      setDragOverColumn(null);
    }
  };

  const handleColumnDrop = async (
    e: DragEvent<HTMLDivElement>,
    status: ProjectStatus,
  ) => {
    e.preventDefault();
    setDragOverColumn(null);

    if (!draggingId) return;

    const project = projects.find((p) => p.id === draggingId);
    if (!project) return;

    await handleMoveProject(project, status);
    setDraggingId(null);
  };

  // Search filtering: by name or HubSpot deal ID
  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  };

  const normalizedSearch = search.trim().toLowerCase();

  const filterProject = (p: Project) => {
    if (!normalizedSearch) return true;
    const nameMatch = p.name.toLowerCase().includes(normalizedSearch);
    const dealMatch = (p.hubspotDealId ?? "")
      .toString()
      .toLowerCase()
      .includes(normalizedSearch);
    return nameMatch || dealMatch;
  };

  const reservedProjects = projects
    .filter((p) => p.status === "reserved")
    .filter(filterProject);
  const wipProjects = projects
    .filter((p) => p.status === "wip")
    .filter(filterProject);
  const completedProjects = projects
    .filter((p) => p.status === "complete")
    .filter(filterProject);

  return (
    <main className="ims-content">
      <section className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Projects &amp; WIP</h1>
          <p className="ims-page-subtitle">
            Each card represents a project. Inventory is removed from the
            warehouse when it&apos;s reserved, then flows through Reserved,
            WIP and Completed as work progresses.
          </p>
        </div>
        <div className="ims-page-actions" style={{ gap: "0.5rem" }}>
          <input
            type="text"
            className="ims-field-input"
            placeholder="Search by name or HubSpot deal ID…"
            value={search}
            onChange={handleSearchChange}
            style={{ minWidth: "260px" }}
          />
          <button
            type="button"
            className="ims-primary-button"
            onClick={() => router.push("/projects/new")}
          >
            + New project
          </button>
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

      {loading ? (
        <p>Loading projects and WIP…</p>
      ) : (
        <section className="ims-kanban">
          {/* Reserved column */}
          <div
            className={`ims-kanban-column${
              dragOverColumn === "reserved"
                ? " ims-kanban-column--active-drop"
                : ""
            }`}
            onDragOver={(e) => handleColumnDragOver(e, "reserved")}
            onDragLeave={(e) => handleColumnDragLeave(e, "reserved")}
            onDrop={(e) => handleColumnDrop(e, "reserved")}
          >
            <header className="ims-kanban-header">
              <div className="ims-kanban-header-left">
                <span className="ims-kanban-status-dot ims-kanban-status-dot--reserved" />
                <h2 className="ims-kanban-title">Reserved</h2>
              </div>
              <span className="ims-kanban-count-pill">
                {reservedProjects.length}
              </span>
            </header>

            {reservedProjects.map((project) => {
              const visibleItems = project.items.filter(
                (line) => line.itemType !== "sensorExtras",
              );
              return (
              <article
                key={project.id}
                className="ims-kanban-card card"
                role="button"
                tabIndex={0}
                draggable
                onClick={() => handleCardClick(project.id)}
                onKeyDown={(e) => handleCardKeyDown(e, project.id)}
                onDragStart={(e) => handleCardDragStart(e, project.id)}
                onDragEnd={handleCardDragEnd}
              >
                <header className="ims-kanban-card-header">
                  <div>
                    <h3 className="ims-kanban-card-title">
                      {project.name}
                    </h3>
                    {project.hubspotDealId && (
                      <p className="ims-kanban-card-subtitle">
                        Project ID: {project.hubspotDealId}
                      </p>
                    )}
                  </div>
                </header>

                <div className="ims-kanban-card-body">
                  {visibleItems.length === 0 ? (
                    <p className="ims-kanban-card-empty">
                      No inventory linked.
                    </p>
                  ) : (
                    <ul className="ims-kanban-products">
                      {visibleItems.map((line, idx) => (
                        <li key={idx}>
                          <span className="ims-kanban-product-main">
                            {line.qty} × {line.itemName}
                          </span>
                          {line.mustHaveItemName && line.mustHaveQty && (
                            <span className="ims-kanban-product-secondary">
                              + {line.mustHaveQty} ×{" "}
                              {line.mustHaveItemName}
                            </span>
                          )}
                          <span className="ims-kanban-product-type">
                            {PROJECT_ITEM_LABELS[line.itemType] ??
                              "Item"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <footer className="ims-kanban-card-footer">
                  <span
                    className="ims-table-empty"
                    style={{ fontSize: "0.75rem" }}
                  >
                    Drag to &quot;WIP&quot; when work starts.
                  </span>
                </footer>
              </article>
            );
            })}

            {reservedProjects.length === 0 && (
              <p className="ims-table-empty">
                No reserved projects. Create one to start tracking stock.
              </p>
            )}
          </div>

          {/* WIP column */}
          <div
            className={`ims-kanban-column${
              dragOverColumn === "wip" ? " ims-kanban-column--active-drop" : ""
            }`}
            onDragOver={(e) => handleColumnDragOver(e, "wip")}
            onDragLeave={(e) => handleColumnDragLeave(e, "wip")}
            onDrop={(e) => handleColumnDrop(e, "wip")}
          >
            <header className="ims-kanban-header">
              <div className="ims-kanban-header-left">
                <span className="ims-kanban-status-dot ims-kanban-status-dot--wip" />
                <h2 className="ims-kanban-title">WIP</h2>
              </div>
              <span className="ims-kanban-count-pill">
                {wipProjects.length}
              </span>
            </header>

            {wipProjects.map((project) => {
              const visibleItems = project.items.filter(
                (line) => line.itemType !== "sensorExtras",
              );
              return (
                <article
                  key={project.id}
                  className="ims-kanban-card card"
                  role="button"
                  tabIndex={0}
                  draggable
                  onClick={() => handleCardClick(project.id)}
                  onKeyDown={(e) => handleCardKeyDown(e, project.id)}
                  onDragStart={(e) => handleCardDragStart(e, project.id)}
                  onDragEnd={handleCardDragEnd}
                >
                  <header className="ims-kanban-card-header">
                    <div>
                      <h3 className="ims-kanban-card-title">
                        {project.name}
                      </h3>
                      {project.hubspotDealId && (
                        <p className="ims-kanban-card-subtitle">
                          Project ID: {project.hubspotDealId}
                        </p>
                      )}
                    </div>
                  </header>

                  <div className="ims-kanban-card-body">
                    {visibleItems.length === 0 ? (
                      <p className="ims-kanban-card-empty">
                        No inventory linked.
                      </p>
                    ) : (
                      <ul className="ims-kanban-products">
                        {visibleItems.map((line, idx) => (
                          <li key={idx}>
                            <span className="ims-kanban-product-main">
                              {line.qty} × {line.itemName}
                            </span>
                            {line.mustHaveItemName && line.mustHaveQty && (
                              <span className="ims-kanban-product-secondary">
                                + {line.mustHaveQty} ×{" "}
                                {line.mustHaveItemName}
                              </span>
                            )}
                            <span className="ims-kanban-product-type">
                              {PROJECT_ITEM_LABELS[line.itemType] ??
                                "Item"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <footer className="ims-kanban-card-footer">
                    <span
                      className="ims-table-empty"
                      style={{ fontSize: "0.75rem" }}
                    >
                      Drag to &quot;Complete&quot; when this project is finished.
                    </span>
                  </footer>
                </article>
              );
            })}

            {wipProjects.length === 0 && (
              <p className="ims-table-empty">
                No projects in WIP. Drag reserved cards here to start work.
              </p>
            )}
          </div>

          {/* Complete column */}
          <div
            className={`ims-kanban-column${
              dragOverColumn === "complete"
                ? " ims-kanban-column--active-drop"
                : ""
            }`}
            onDragOver={(e) => handleColumnDragOver(e, "complete")}
            onDragLeave={(e) => handleColumnDragLeave(e, "complete")}
            onDrop={(e) => handleColumnDrop(e, "complete")}
          >
            <header className="ims-kanban-header">
              <div className="ims-kanban-header-left">
                <span className="ims-kanban-status-dot ims-kanban-status-dot--complete" />
                <h2 className="ims-kanban-title">Complete</h2>
              </div>
              <span className="ims-kanban-count-pill">
                {completedProjects.length}
              </span>
            </header>

            {completedProjects.map((project) => {
              const visibleItems = project.items.filter(
                (line) => line.itemType !== "sensorExtras",
              );
              return (
                <article
                  key={project.id}
                  className="ims-kanban-card card ims-kanban-card--complete"
                  role="button"
                  tabIndex={0}
                  draggable
                  onClick={() => handleCardClick(project.id)}
                  onKeyDown={(e) => handleCardKeyDown(e, project.id)}
                  onDragStart={(e) => handleCardDragStart(e, project.id)}
                  onDragEnd={handleCardDragEnd}
                >
                  <header className="ims-kanban-card-header">
                    <div>
                      <h3 className="ims-kanban-card-title">
                        {project.name}
                      </h3>
                      {project.hubspotDealId && (
                        <p className="ims-kanban-card-subtitle">
                          Project ID: {project.hubspotDealId}
                        </p>
                      )}
                    </div>
                  </header>

                  <div className="ims-kanban-card-body">
                    {visibleItems.length === 0 ? (
                      <p className="ims-kanban-card-empty">
                        No inventory linked.
                      </p>
                    ) : (
                      <ul className="ims-kanban-products">
                        {visibleItems.map((line, idx) => (
                          <li key={idx}>
                            <span className="ims-kanban-product-main">
                              {line.qty} × {line.itemName}
                            </span>
                            {line.mustHaveItemName && line.mustHaveQty && (
                              <span className="ims-kanban-product-secondary">
                                + {line.mustHaveQty} ×{" "}
                                {line.mustHaveItemName}
                              </span>
                            )}
                            <span className="ims-kanban-product-type">
                              {PROJECT_ITEM_LABELS[line.itemType] ??
                                "Item"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <footer className="ims-kanban-card-footer">
                    <span
                      className="ims-table-empty"
                      style={{ fontSize: "0.75rem" }}
                    >
                      Drag back if this project reopens.
                    </span>
                  </footer>
                </article>
              );
            })}

            {completedProjects.length === 0 && (
              <p className="ims-table-empty">
                No completed projects yet. As you finish WIP cards, drag
                them here to update completed stock.
              </p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
