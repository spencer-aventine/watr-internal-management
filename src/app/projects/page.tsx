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
  addDoc,
  doc,
  query,
  orderBy,
  Timestamp,
  writeBatch,
  increment,
} from "firebase/firestore";

type ItemOption = {
  id: string;
  name: string;
  sku: string;
  mustHaveName?: string | null;
};

type ProjectItemLine = {
  itemId: string;
  itemName: string;
  qty: number;
  mustHaveItemId?: string | null;
  mustHaveItemName?: string | null;
  mustHaveQty?: number | null;
};

type ProjectStatus = "reserved" | "wip" | "complete";

type Project = {
  id: string;
  name: string;
  status: ProjectStatus;
  hubspotDealId?: string | null;
  items: ProjectItemLine[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

type NewLineState = {
  id: string;
  itemId: string;
  qty: string;
  mustHaveItemId?: string | null;
  mustHaveLabel?: string;
  mustHaveQty: string;
};

export default function ProjectsWipPage() {
  const router = useRouter();

  const [items, setItems] = useState<ItemOption[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingProject, setSavingProject] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // New project form state
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDealId, setNewDealId] = useState("");
  const [newLines, setNewLines] = useState<NewLineState[]>([
    { id: "line-1", itemId: "", qty: "", mustHaveQty: "" },
  ]);

  // Search (by name or HubSpot deal ID)
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
      // Load items for selectors
      const itemsSnap = await getDocs(
        query(collection(db, "items"), orderBy("name")),
      );
      const itemOptions: ItemOption[] = itemsSnap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data.name ?? "",
          sku: data.sku ?? "",
          mustHaveName: data.mustHave ?? null,
        };
      });
      setItems(itemOptions);

      // Load projects
      const projectsSnap = await getDocs(
        query(collection(db, "projects"), orderBy("createdAt", "desc")),
      );
      const projRows: Project[] = projectsSnap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data.name ?? "",
          status:
            (data.status as ProjectStatus) ??
            "reserved",
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
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
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

  const handleAddLine = () => {
    setNewLines((prev) => [
      ...prev,
      {
        id: `line-${Date.now()}`,
        itemId: "",
        qty: "",
        mustHaveQty: "",
      },
    ]);
  };

  const handleRemoveLine = (lineId: string) => {
    setNewLines((prev) => prev.filter((l) => l.id !== lineId));
  };

  const handleLineItemChange = (lineId: string, itemId: string) => {
    setNewLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;

        const item = items.find((i) => i.id === itemId);

        let mustHaveItemId: string | null = null;
        let mustHaveLabel: string | undefined;

        if (item?.mustHaveName) {
          const mustItem = items.find((i) => i.name === item.mustHaveName);
          if (mustItem) {
            mustHaveItemId = mustItem.id;
            mustHaveLabel = `${mustItem.name} (must have)`;
          }
        }

        return {
          ...l,
          itemId,
          mustHaveItemId,
          mustHaveLabel,
          mustHaveQty: mustHaveItemId ? l.mustHaveQty || l.qty || "1" : "",
        };
      }),
    );
  };

  const handleLineQtyChange = (lineId: string, qty: string) => {
    setNewLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, qty } : l)),
    );
  };

  const handleLineMustHaveQtyChange = (lineId: string, qty: string) => {
    setNewLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, mustHaveQty: qty } : l)),
    );
  };

  /**
   * Create a new project.
   * - Starts in "reserved".
   * - Inventory is reduced and moved into reserved.
   */
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setError("Project name is required.");
      return;
    }

    const validLines = newLines.filter(
      (l) => l.itemId && Number(l.qty) > 0,
    );
    if (!validLines.length) {
      setError("Add at least one product with a quantity.");
      return;
    }

    setSavingProject(true);
    setError(null);
    setMessage(null);

    try {
      const now = Timestamp.now();

      // Build items array for project doc (no undefineds)
      const itemsForProject: ProjectItemLine[] = validLines.map((l) => {
        const item = items.find((i) => i.id === l.itemId);
        const mustItem =
          l.mustHaveItemId != null
            ? items.find((i) => i.id === l.mustHaveItemId)
            : undefined;

        const qty = Number(l.qty);
        const mustQty =
          l.mustHaveItemId && l.mustHaveQty
            ? Number(l.mustHaveQty)
            : null;

        return {
          itemId: l.itemId,
          itemName: item?.name ?? "",
          qty,
          mustHaveItemId: l.mustHaveItemId ?? null,
          mustHaveItemName: mustItem?.name ?? null,
          mustHaveQty: mustQty,
        };
      });

      // Prepare doc payload explicitly without undefined
      const projectDoc = {
        name: newName.trim(),
        status: "reserved" as const,
        hubspotDealId: newDealId.trim() || null,
        items: itemsForProject.map((line) => ({
          itemId: line.itemId,
          itemName: line.itemName,
          qty: line.qty,
          ...(line.mustHaveItemId
            ? { mustHaveItemId: line.mustHaveItemId }
            : {}),
          ...(line.mustHaveItemName
            ? { mustHaveItemName: line.mustHaveItemName }
            : {}),
          ...(typeof line.mustHaveQty === "number" && line.mustHaveQty > 0
            ? { mustHaveQty: line.mustHaveQty }
            : {}),
        })),
        createdAt: now,
        updatedAt: now,
      };

      // Create project doc
      await addDoc(collection(db, "projects"), projectDoc);

      // Update item inventory / reserved
      const batch = writeBatch(db);

      itemsForProject.forEach((line) => {
        if (!line.itemId || !line.qty) return;
        const itemRef = doc(db, "items", line.itemId);
        batch.update(itemRef, {
          inventoryQty: increment(-line.qty), // inventory = in warehouse
          reservedQty: increment(line.qty),   // reserved for this project
          updatedAt: now,
        });

        if (line.mustHaveItemId && line.mustHaveQty && line.mustHaveQty > 0) {
          const mustRef = doc(db, "items", line.mustHaveItemId);
          batch.update(mustRef, {
            inventoryQty: increment(-line.mustHaveQty),
            reservedQty: increment(line.mustHaveQty),
            updatedAt: now,
          });
        }
      });

      await batch.commit();

      setMessage("Project created, inventory reserved and stock updated.");
      setNewName("");
      setNewDealId("");
      setNewLines([{ id: "line-1", itemId: "", qty: "", mustHaveQty: "" }]);
      setShowNewForm(false);

      // Reload projects & items
      await loadData();
    } catch (err: any) {
      console.error("Error creating project", err);
      setError(err?.message ?? "Error creating project");
    } finally {
      setSavingProject(false);
    }
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

      // Update project status
      const projRef = doc(db, "projects", project.id);
      batch.update(projRef, {
        status: targetStatus,
        updatedAt: now,
      });

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
            onClick={() => setShowNewForm((v) => !v)}
          >
            {showNewForm ? "Close new project" : "+ New project"}
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

            {showNewForm && (
              <div className="ims-kanban-card card ims-kanban-card--new">
                <h3 className="ims-form-section-title">New project</h3>
                <p className="ims-form-section-subtitle">
                  Set up a project, link to products and optionally a HubSpot
                  deal. Inventory is reserved immediately.
                </p>

                <form
                  onSubmit={handleCreateProject}
                  className="ims-new-project-form"
                >
                  <div className="ims-field">
                    <label className="ims-field-label" htmlFor="projName">
                      Project name<span className="ims-required">*</span>
                    </label>
                    <input
                      id="projName"
                      className="ims-field-input"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                  </div>

                  <div className="ims-field">
                    <label className="ims-field-label" htmlFor="dealId">
                      HubSpot deal ID
                    </label>
                    <input
                      id="dealId"
                      className="ims-field-input"
                      value={newDealId}
                      onChange={(e) => setNewDealId(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>

                  <hr className="ims-form-divider" />

                  <div className="ims-field">
                    <div className="ims-form-section-title">
                      Products in this project
                    </div>
                    <p className="ims-form-section-subtitle">
                      Choose one or more products. If a product has a
                      &quot;must have&quot; item, we&apos;ll pull it in
                      automatically so you can set quantities for both.
                    </p>
                  </div>

                  {newLines.map((line, index) => (
                    <div
                      key={line.id}
                      className="ims-field ims-project-line"
                    >
                      <div className="ims-field-row">
                        <div className="ims-field">
                          <label className="ims-field-label">
                            Product {index + 1}
                          </label>
                          <select
                            className="ims-field-input"
                            value={line.itemId}
                            onChange={(e) =>
                              handleLineItemChange(
                                line.id,
                                e.target.value,
                              )
                            }
                          >
                            <option value="">Select a product…</option>
                            {items.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name} ({item.sku})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="ims-field">
                          <label className="ims-field-label">
                            Quantity
                          </label>
                          <input
                            type="number"
                            min={1}
                            className="ims-field-input"
                            value={line.qty}
                            onChange={(e) =>
                              handleLineQtyChange(
                                line.id,
                                e.target.value,
                              )
                            }
                          />
                        </div>
                      </div>

                      {line.mustHaveItemId && line.mustHaveLabel && (
                        <div className="ims-field-row">
                          <div className="ims-field">
                            <label className="ims-field-label">
                              {line.mustHaveLabel}
                            </label>
                            <div className="ims-field-help">
                              This product is required whenever the main
                              product is used.
                            </div>
                          </div>
                          <div className="ims-field">
                            <label className="ims-field-label">
                              Required quantity
                            </label>
                            <input
                              type="number"
                              min={1}
                              className="ims-field-input"
                              value={line.mustHaveQty}
                              onChange={(e) =>
                                handleLineMustHaveQtyChange(
                                  line.id,
                                  e.target.value,
                                )
                              }
                            />
                          </div>
                        </div>
                      )}

                      {newLines.length > 1 && (
                        <button
                          type="button"
                          className="ims-secondary-button ims-project-line-remove"
                          onClick={() => handleRemoveLine(line.id)}
                        >
                          Remove line
                        </button>
                      )}
                    </div>
                  ))}

                  <button
                    type="button"
                    className="ims-secondary-button"
                    onClick={handleAddLine}
                    style={{ marginTop: "0.5rem" }}
                  >
                    + Add product line
                  </button>

                  <div
                    style={{
                      marginTop: "0.75rem",
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "0.5rem",
                    }}
                  >
                    <button
                      type="button"
                      className="ims-secondary-button"
                      onClick={() => {
                        setShowNewForm(false);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="ims-primary-button"
                      disabled={savingProject}
                    >
                      {savingProject ? "Creating…" : "Create project"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {reservedProjects.map((project) => (
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
                        Deal ID: {project.hubspotDealId}
                      </p>
                    )}
                  </div>
                </header>

                <div className="ims-kanban-card-body">
                  {project.items.length === 0 ? (
                    <p className="ims-kanban-card-empty">
                      No products linked.
                    </p>
                  ) : (
                    <ul className="ims-kanban-products">
                      {project.items.map((line, idx) => (
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
            ))}

            {!showNewForm && reservedProjects.length === 0 && (
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

            {wipProjects.map((project) => (
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
                        Deal ID: {project.hubspotDealId}
                      </p>
                    )}
                  </div>
                </header>

                <div className="ims-kanban-card-body">
                  {project.items.length === 0 ? (
                    <p className="ims-kanban-card-empty">
                      No products linked.
                    </p>
                  ) : (
                    <ul className="ims-kanban-products">
                      {project.items.map((line, idx) => (
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
            ))}

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

            {completedProjects.map((project) => (
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
                        Deal ID: {project.hubspotDealId}
                      </p>
                    )}
                  </div>
                </header>

                <div className="ims-kanban-card-body">
                  {project.items.length === 0 ? (
                    <p className="ims-kanban-card-empty">
                      No products linked.
                    </p>
                  ) : (
                    <ul className="ims-kanban-products">
                      {project.items.map((line, idx) => (
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
            ))}

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
