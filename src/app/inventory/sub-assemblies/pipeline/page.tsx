// src/app/inventory/sub-assemblies/pipeline/page.tsx
"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizeItemType } from "@/lib/inventoryPaths";
import {
  fetchWarehouseLocations,
  WAREHOUSE_LOCATION_DEFAULTS,
} from "@/lib/warehouseLocations";

const toDateSafe = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  if (typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

type ManufactureStatus = "start_manufacture" | "manufacture_complete";

type SubAssembly = {
  id: string;
  name: string;
  sku?: string | null;
  owner?: string | null;
  storageLocation?: string | null;
  manufactureStatus: ManufactureStatus;
  plannedQuantity: number | null;
  standardCost?: number | null;
  updatedAt?: Timestamp | null;
  dueDate?: Date | null;
};

const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

const statusConfig: Record<
  ManufactureStatus,
  { title: string; helper: string; dotClass: string }
> = {
  start_manufacture: {
    title: "Start manufacture",
    helper: "Drag to complete once the run finishes.",
    dotClass: "ims-kanban-status-dot--reserved",
  },
  manufacture_complete: {
    title: "Manufacture complete",
    helper: "Drag back if more work is needed.",
    dotClass: "ims-kanban-status-dot--complete",
  },
};

const isSubAssemblyType = (value?: string | null) => {
  const normalized = normalizeItemType(value);
  return (
    normalized === "sub assembly" ||
    normalized === "sub assemblies" ||
    normalized === "subassembly"
  );
};

const isManufactureStatus = (value: any): value is ManufactureStatus =>
  value === "start_manufacture" || value === "manufacture_complete";

export default function SubAssemblyPipelinePage() {
  const router = useRouter();
  const [assemblies, setAssemblies] = useState<SubAssembly[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<ManufactureStatus | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    assemblyId: "",
    storageLocation: "Downstairs",
    ownerId: "",
    quantity: "1",
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSaving, setCreateSaving] = useState(false);
  const [owners, setOwners] = useState<
    { id: string; email: string; label: string }[]
  >([]);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [locations, setLocations] = useState<string[]>(WAREHOUSE_LOCATION_DEFAULTS);
  const [locationLoading, setLocationLoading] = useState(false);
  const [componentsPreview, setComponentsPreview] = useState<
    {
      id: string;
      name: string;
      perAssembly: number;
      available: number;
      maxAssemblies: number | null;
    }[]
  >([]);
  const [componentsLoading, setComponentsLoading] = useState(false);
  const [componentsError, setComponentsError] = useState<string | null>(null);
  const [maxBuildable, setMaxBuildable] = useState<number | null>(null);
  const [showAll, setShowAll] = useState<Record<ManufactureStatus, boolean>>({
    start_manufacture: false,
    manufacture_complete: false,
  });

  const loadAssemblies = async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(query(collection(db, "items"), orderBy("name")));
      const rows: SubAssembly[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as any;
        if (
          !isSubAssemblyType(data.itemType ?? data.rawCsvItemType ?? data.category)
        ) {
          return;
        }
        const status = isManufactureStatus(data.manufactureStatus)
          ? (data.manufactureStatus as ManufactureStatus)
          : "start_manufacture";
        rows.push({
          id: docSnap.id,
          name: data.name ?? data.sku ?? "Sub-assembly",
          sku: data.sku ?? data.shortCode ?? null,
          owner: data.subAssemblyOwner ?? data.owner ?? null,
          storageLocation: data.storageLocation ?? "Downstairs",
          manufactureStatus: status,
          plannedQuantity:
            typeof data.manufacturePlannedQty === "number"
              ? data.manufacturePlannedQty
              : null,
          standardCost:
            typeof data.standardCost === "number" ? data.standardCost : null,
          updatedAt: data.updatedAt ?? null,
          dueDate: toDateSafe(data.dueDate),
        });
      });
      setAssemblies(rows);
    } catch (err: any) {
      console.error("Error loading sub-assembly pipeline", err);
      setError(err?.message ?? "Unable to load sub-assemblies.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssemblies();
  }, []);

  useEffect(() => {
    const loadOwners = async () => {
      setOwnerLoading(true);
      try {
        const snap = await getDocs(collection(db, "users"));
        const options: { id: string; email: string; label: string }[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const accountStatus = (data.accountStatus ?? "").toString();
          if (
            accountStatus === "admin" ||
            accountStatus === "coreUser" ||
            accountStatus === "core user" ||
            accountStatus === "core-user"
          ) {
            const email = data.email ?? "Unknown user";
            options.push({
              id: docSnap.id,
              email,
              label: email,
            });
          }
        });
        options.sort((a, b) => a.label.localeCompare(b.label));
        setOwners(options);
      } catch (err) {
        console.error("Error loading owners", err);
      } finally {
        setOwnerLoading(false);
      }
    };
    loadOwners();
  }, []);

  useEffect(() => {
    const loadLocations = async () => {
      setLocationLoading(true);
      try {
        const options = await fetchWarehouseLocations();
        setLocations(options);
        setCreateForm((prev) => ({
          ...prev,
          storageLocation: prev.storageLocation || options[0] || WAREHOUSE_LOCATION_DEFAULTS[0],
        }));
      } catch (err) {
        console.error("Error loading warehouse locations", err);
      } finally {
        setLocationLoading(false);
      }
    };
    loadLocations();
  }, []);

  const filteredAssemblies = useMemo(() => {
    const text = search.trim().toLowerCase();
    if (!text) return assemblies;
    return assemblies.filter((assembly) => {
      const values = [
        assembly.name,
        assembly.sku,
        assembly.owner,
        assembly.storageLocation,
      ]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());
      return values.some((value) => value.includes(text));
    });
  }, [assemblies, search]);

  const startList = filteredAssemblies.filter(
    (assembly) => assembly.manufactureStatus === "start_manufacture",
  );
  const completeList = filteredAssemblies.filter(
    (assembly) => assembly.manufactureStatus === "manufacture_complete",
  );
  const visibleStart = showAll.start_manufacture ? startList : startList.slice(0, 10);
  const visibleComplete = showAll.manufacture_complete
    ? completeList
    : completeList.slice(0, 10);
  const selectableAssemblies = useMemo(() => {
    return [...assemblies].sort((a, b) => a.name.localeCompare(b.name));
  }, [assemblies]);
  const locationOptions = useMemo(() => {
    const set = new Set(locations);
    if (createForm.storageLocation && !set.has(createForm.storageLocation)) {
      set.add(createForm.storageLocation);
    }
    return Array.from(set);
  }, [locations, createForm.storageLocation]);

  const refreshComponentPreview = async (assemblyId: string) => {
    if (!assemblyId) {
      setComponentsPreview([]);
      setMaxBuildable(null);
      setComponentsError(null);
      return;
    }
    setComponentsLoading(true);
    setComponentsError(null);
    try {
      const assemblySnap = await getDoc(doc(db, "items", assemblyId));
      if (!assemblySnap.exists()) {
        setComponentsError("Sub-assembly not found.");
        setComponentsPreview([]);
        setMaxBuildable(null);
        return;
      }
      const assemblyData = assemblySnap.data() as any;
      const components: Array<Record<string, unknown>> = Array.isArray(assemblyData.components)
        ? assemblyData.components
        : [];
      const normalizedComponents: Array<{ componentId: string; perAssembly: number }> = components
        .map((component) => {
          const componentId =
            (component.componentId as string | null | undefined) ??
            (component.itemId as string | null | undefined) ??
            (component.id as string | null | undefined) ??
            (component.referenceId as string | null | undefined) ??
            null;
          const perAssembly = Number(
            (component.quantity as number | string | undefined) ??
              (component.qty as number | string | undefined) ??
              0,
          );
          if (!componentId || !Number.isFinite(perAssembly) || perAssembly <= 0) {
            return null;
          }
          return { componentId: String(componentId), perAssembly };
        })
        .filter((entry): entry is { componentId: string; perAssembly: number } =>
          Boolean(entry),
        );
      if (!normalizedComponents.length) {
        setComponentsPreview([]);
        setMaxBuildable(null);
        return;
      }
      const componentDocs = await Promise.all(
        normalizedComponents.map((entry) => getDoc(doc(db, "items", entry.componentId))),
      );
      const rows: {
        id: string;
        name: string;
        perAssembly: number;
        available: number;
        maxAssemblies: number | null;
      }[] = [];
      componentDocs.forEach((snap, idx) => {
        const entry = normalizedComponents[idx];
        if (!snap.exists()) return;
        const data = snap.data() as any;
        const available = Number(data.inventoryQty ?? 0) || 0;
        const maxAssemblies =
          entry.perAssembly > 0 ? Math.floor(available / entry.perAssembly) : null;
        rows.push({
          id: snap.id,
          name: data.name ?? data.sku ?? "Component",
          perAssembly: entry.perAssembly,
          available,
          maxAssemblies,
        });
      });
      const feasible = rows
        .map((row) => row.maxAssemblies)
        .filter((value): value is number => value != null && Number.isFinite(value));
      const maxPossible = feasible.length ? Math.min(...feasible) : null;
      setComponentsPreview(rows);
      setMaxBuildable(maxPossible);
    } catch (err) {
      console.error("Error loading component preview", err);
      setComponentsError("Unable to load component availability for this assembly.");
      setComponentsPreview([]);
      setMaxBuildable(null);
    } finally {
      setComponentsLoading(false);
    }
  };

  const handleMoveAssembly = async (
    assembly: SubAssembly,
    targetStatus: ManufactureStatus,
  ) => {
    if (assembly.manufactureStatus === targetStatus) return;
    setError(null);
    setMessage(null);
    try {
      const updates: Record<string, any> = {
        manufactureStatus: targetStatus,
        updatedAt: Timestamp.now(),
      };
      if (targetStatus === "start_manufacture" && assembly.plannedQuantity) {
        updates.wipQty = increment(assembly.plannedQuantity);
      }
      if (targetStatus === "manufacture_complete" && assembly.plannedQuantity) {
        updates.wipQty = increment(-assembly.plannedQuantity);
        updates.completedQty = increment(assembly.plannedQuantity);
      }
      await updateDoc(doc(db, "items", assembly.id), {
        ...updates,
      });
      setAssemblies((prev) =>
        prev.map((item) =>
          item.id === assembly.id
            ? { ...item, manufactureStatus: targetStatus }
            : item,
        ),
      );
      setMessage(
        `Moved ${assembly.name} to “${statusConfig[targetStatus].title}”.`,
      );
    } catch (err: any) {
      console.error("Error updating manufacture status", err);
      setError(err?.message ?? "Unable to update manufacture status.");
    }
  };

  const handleCardClick = (assemblyId: string) => {
    if (draggingId) return;
    router.push(`/inventory/sub-assemblies/pipeline/${assemblyId}`);
  };

  const handleCardKeyDown = (e: KeyboardEvent<HTMLElement>, assemblyId: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCardClick(assemblyId);
    }
  };

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  };

  const handleCardDragStart = (e: DragEvent<HTMLElement>, assemblyId: string) => {
    setDraggingId(assemblyId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleCardDragEnd = () => {
    setDraggingId(null);
    setDragOverStatus(null);
  };

  const handleColumnDragOver = (
    e: DragEvent<HTMLDivElement>,
    status: ManufactureStatus,
  ) => {
    e.preventDefault();
    if (dragOverStatus !== status) {
      setDragOverStatus(status);
    }
    e.dataTransfer.dropEffect = "move";
  };

  const handleColumnDragLeave = (
    _e: DragEvent<HTMLDivElement>,
    status: ManufactureStatus,
  ) => {
    if (dragOverStatus === status) {
      setDragOverStatus(null);
    }
  };

  const handleColumnDrop = (
    e: DragEvent<HTMLDivElement>,
    status: ManufactureStatus,
  ) => {
    e.preventDefault();
    setDragOverStatus(null);
    if (!draggingId) return;
    const assembly = assemblies.find((item) => item.id === draggingId);
    if (!assembly) return;
    handleMoveAssembly(assembly, status);
    setDraggingId(null);
  };

  const renderCard = (assembly: SubAssembly, status: ManufactureStatus) => (
    <article
      key={assembly.id}
      className="ims-kanban-card card"
      role="button"
      tabIndex={0}
      draggable
      onClick={() => handleCardClick(assembly.id)}
      onKeyDown={(e) => handleCardKeyDown(e, assembly.id)}
      onDragStart={(e) => handleCardDragStart(e, assembly.id)}
      onDragEnd={handleCardDragEnd}
      style={{
        padding: "0.85rem",
        gap: "0.45rem",
        fontSize: "0.95rem",
        lineHeight: 1.35,
      }}
    >
      <header className="ims-kanban-card-header">
        <div>
          <h3
            className="ims-kanban-card-title"
            style={{ fontSize: "1rem", marginBottom: "0.15rem" }}
          >
            {assembly.name}
          </h3>
          {assembly.sku && (
            <p
              className="ims-kanban-card-subtitle"
              style={{ fontSize: "0.82rem", color: "#6b7280", margin: 0 }}
            >
              SKU: {assembly.sku}
            </p>
          )}
        </div>
      </header>
      <div className="ims-kanban-card-body" style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <span
            className="ims-status-tag ims-status-tag--active"
            style={{ fontSize: "0.78rem" }}
          >
            {assembly.storageLocation || "Storage not set"}
          </span>
          <span
            className="ims-status-tag"
            style={{
              fontSize: "0.78rem",
              background: "#e5e7eb",
              color: "#374151",
            }}
          >
            {assembly.owner || "Unassigned"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.3rem 0.5rem" }}>
          <div style={{ fontSize: "0.82rem", color: "#4b5563" }}>Units in this run</div>
          <div style={{ fontWeight: 600 }}>
            {assembly.plannedQuantity != null ? assembly.plannedQuantity : "—"}
          </div>
          <div style={{ fontSize: "0.82rem", color: "#4b5563" }}>Due date</div>
          <div style={{ fontWeight: 600 }}>
            {assembly.dueDate ? assembly.dueDate.toLocaleDateString() : "—"}
          </div>
          <div style={{ fontSize: "0.82rem", color: "#4b5563" }}>Standard cost</div>
          <div style={{ fontWeight: 600 }}>
            {assembly.standardCost != null
              ? currencyFormatter.format(assembly.standardCost)
              : "—"}
          </div>
        </div>
      </div>
      <footer className="ims-kanban-card-footer">
        <span className="ims-table-empty" style={{ fontSize: "0.75rem" }}>
          {statusConfig[status].helper}
        </span>
      </footer>
    </article>
  );

  const handleCreateSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    if (!createForm.assemblyId) {
      setCreateError("Select a sub-assembly to start manufacturing.");
      return;
    }
    const qtyNumber = Number(createForm.quantity);
    if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) {
      setCreateError("Enter how many assemblies you are starting.");
      return;
    }
    if (!createForm.ownerId) {
      setCreateError("Assign an owner for this manufacturing run.");
      return;
    }
    setCreateSaving(true);
    setMessage(null);
    setError(null);
    try {
      await updateDoc(doc(db, "items", createForm.assemblyId), {
        manufactureStatus: "start_manufacture",
        subAssemblyOwner:
          (owners.find((owner) => owner.id === createForm.ownerId)?.label ??
            createForm.ownerId) || null,
        storageLocation: createForm.storageLocation || "Downstairs",
        manufacturePlannedQty: qtyNumber,
        wipQty: increment(qtyNumber),
        updatedAt: Timestamp.now(),
      });
      setCreateForm({
        assemblyId: "",
        storageLocation: "Downstairs",
        ownerId: "",
        quantity: "1",
      });
      setComponentsPreview([]);
      setMaxBuildable(null);
      setCreating(false);
      setMessage(
        "Marked as ready to collect components in the warehouse. Find it under “Start manufacture.”",
      );
      await loadAssemblies();
    } catch (err: any) {
      console.error("Error creating sub-assembly from pipeline", err);
      setCreateError(err?.message ?? "Unable to add this sub-assembly.");
    } finally {
      setCreateSaving(false);
    }
  };

  return (
    <main className="ims-content">
      <section className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Sub-assembly pipeline</h1>
          <p className="ims-page-subtitle">
            Move assemblies from “Start manufacture” to “Manufacture complete” to
            track build progress.
          </p>
        </div>
        <div className="ims-page-actions" style={{ gap: "0.5rem" }}>
          <input
            type="text"
            className="ims-field-input"
            placeholder="Search by name, SKU, owner or location…"
            value={search}
            onChange={handleSearchChange}
            style={{ minWidth: "260px" }}
          />
          <Link href="/inventory" className="ims-secondary-button">
            Inventory
          </Link>
          {creating ? (
            <button
              type="button"
              className="ims-secondary-button"
              onClick={() => {
                setCreating(false);
                setCreateError(null);
              }}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="ims-primary-button"
              onClick={() => setCreating(true)}
            >
              Start manufacturing
            </button>
          )}
        </div>
      </section>

      {(message || error) && (
        <div
          className={
            "ims-alert " + (error ? "ims-alert--error" : "ims-alert--info")
          }
        >
          {error || message}
        </div>
      )}

      {creating && (
        <section className="ims-form-section card" style={{ marginBottom: "1rem" }}>
          <div className="ims-table-header">
            <div>
              <h2 className="ims-form-section-title">Start manufacturing</h2>
              <p className="ims-form-section-subtitle">
                Select a sub-assembly to start collecting its components in the warehouse.
              </p>
            </div>
          </div>
          {createError && (
            <div
              className="ims-alert ims-alert--error"
              style={{ marginBottom: "0.75rem" }}
            >
              {createError}
            </div>
          )}
          <form className="ims-form-stack" onSubmit={handleCreateSubmit} style={{ gap: "0.75rem" }}>
            <div className="ims-field" style={{ maxWidth: "420px" }}>
              <label className="ims-field-label" htmlFor="quickAssembly">
                Sub-assembly<span className="ims-required">*</span>
              </label>
              <select
                id="quickAssembly"
                className="ims-field-input"
                value={createForm.assemblyId}
                onChange={(e) => {
                  const nextAssemblyId = e.target.value;
                  const match = assemblies.find((a) => a.id === nextAssemblyId);
                  const nextLocation =
                    (match?.storageLocation &&
                      (locations.includes(match.storageLocation)
                        ? match.storageLocation
                        : match.storageLocation)) ||
                    locations[0] ||
                    WAREHOUSE_LOCATION_DEFAULTS[0];
                  setCreateForm((prev) => ({
                    ...prev,
                    assemblyId: nextAssemblyId,
                    storageLocation: nextLocation,
                    ownerId: "",
                  }));
                  refreshComponentPreview(nextAssemblyId);
                }}
              >
                <option value="">Select a sub-assembly…</option>
                {selectableAssemblies.map((assembly) => (
                  <option key={assembly.id} value={assembly.id}>
                    {assembly.name}
                    {assembly.sku ? ` · ${assembly.sku}` : ""}
                    {assembly.owner ? ` · ${assembly.owner}` : ""}
                  </option>
                ))}
              </select>
              <p className="ims-field-help">
                Kicks off collection of the listed components. Cards move to “Manufacture
                complete” when everything is assembled.
              </p>
            </div>
            <div className="ims-form-actions">
              <div className="ims-field-row" style={{ width: "100%", gap: "0.75rem" }}>
                <div className="ims-field" style={{ flex: 1 }}>
                  <label className="ims-field-label" htmlFor="quickQuantity">
                    Units to assemble<span className="ims-required">*</span>
                  </label>
                  <input
                    id="quickQuantity"
                    className="ims-field-input"
                    type="number"
                    min="1"
                    step="1"
                    value={createForm.quantity}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, quantity: e.target.value }))
                    }
                  />
                  {maxBuildable != null && (
                    <p
                      className="ims-field-help"
                      style={
                        Number(createForm.quantity) > maxBuildable
                          ? { color: "#b45309", fontWeight: 600 }
                          : undefined
                      }
                    >
                      Max based on current component stock: {maxBuildable}. You can
                      still request more, but components may run short.
                    </p>
                  )}
                </div>
                <div className="ims-field" style={{ flex: 1 }}>
                  <label className="ims-field-label" htmlFor="quickStorage">
                    Storage location
                  </label>
                  <select
                    id="quickStorage"
                    className="ims-field-input"
                    value={createForm.storageLocation}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        storageLocation: e.target.value,
                      }))
                    }
                    disabled={locationLoading}
                  >
                    {locationOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ims-field" style={{ flex: 1 }}>
                  <label className="ims-field-label" htmlFor="quickOwner">
                    Owner<span className="ims-required">*</span>
                  </label>
                  <select
                    id="quickOwner"
                    className="ims-field-input"
                    value={createForm.ownerId}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, ownerId: e.target.value }))
                    }
                  >
                    <option value="">Select owner…</option>
                    {owners.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.label}
                      </option>
                    ))}
                  </select>
                  {ownerLoading && (
                    <p className="ims-field-help">Loading authorized users…</p>
                  )}
                </div>
              </div>

              {componentsLoading ? (
                <p className="ims-table-empty" style={{ marginTop: "0.35rem" }}>
                  Checking component availability…
                </p>
              ) : componentsError ? (
                <div
                  className="ims-alert ims-alert--error"
                  style={{ marginTop: "0.35rem" }}
                >
                  {componentsError}
                </div>
              ) : componentsPreview.length ? (
                <div className="ims-table-wrapper" style={{ marginTop: "0.35rem" }}>
                  <table className="ims-table ims-table--compact">
                    <thead>
                      <tr>
                        <th>Component</th>
                        <th>Per assembly</th>
                        <th>Available</th>
                        <th>Supports</th>
                      </tr>
                    </thead>
                    <tbody>
                      {componentsPreview.map((row) => (
                        <tr key={row.id}>
                          <td>{row.name}</td>
                          <td>{row.perAssembly}</td>
                          <td>{row.available}</td>
                          <td>
                            {row.maxAssemblies != null ? row.maxAssemblies : "—"}{" "}
                            assemblies
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="ims-field-help">
                  Select a sub-assembly to see component availability guidance.
                </p>
              )}

              <button
                type="submit"
                className="ims-primary-button"
                disabled={createSaving}
              >
                {createSaving ? "Starting…" : "Begin manufacturing"}
              </button>
              <p className="ims-field-help">
                Cards land in “Start manufacture”. Open the card to view or edit details.
              </p>
            </div>
          </form>
        </section>
      )}

      {loading ? (
        <p>Loading sub-assembly pipeline…</p>
      ) : (
        <section
          className="ims-kanban"
          style={{ alignItems: "stretch", gap: "0.75rem" }}
        >
          {(
            [
              "start_manufacture",
              "manufacture_complete",
            ] as ManufactureStatus[]
          ).map((status) => {
            const columnList =
              status === "start_manufacture" ? startList : completeList;
            const visibleList =
              status === "start_manufacture" ? visibleStart : visibleComplete;
            const isActiveDrop = dragOverStatus === status;
            return (
              <div
                key={status}
                className={`ims-kanban-column${
                  isActiveDrop ? " ims-kanban-column--active-drop" : ""
                }`}
                style={{
                  minHeight: "72vh",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.65rem",
                }}
                onDragOver={(e) => handleColumnDragOver(e, status)}
                onDragLeave={(e) => handleColumnDragLeave(e, status)}
                onDrop={(e) => handleColumnDrop(e, status)}
              >
                <header className="ims-kanban-header">
                  <div className="ims-kanban-header-left">
                    <span
                      className={`ims-kanban-status-dot ${statusConfig[status].dotClass}`}
                    />
                    <h2 className="ims-kanban-title">
                      {statusConfig[status].title}
                    </h2>
                  </div>
                  <span className="ims-kanban-count-pill">
                    {columnList.length}
                  </span>
                </header>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", flex: 1 }}>
                  {columnList.length === 0 ? (
                    <p className="ims-table-empty" style={{ flex: 1 }}>
                      {status === "start_manufacture"
                        ? "No assemblies queued to build."
                        : "Nothing marked as complete yet."}
                    </p>
                  ) : (
                    visibleList.map((assembly) => renderCard(assembly, status))
                  )}
                </div>

                {!showAll[status] && columnList.length > 10 && (
                  <button
                    type="button"
                    className="ims-secondary-button"
                    onClick={() =>
                      setShowAll((prev) => ({ ...prev, [status]: true }))
                    }
                    style={{ marginTop: "0.25rem" }}
                  >
                    Show more ({columnList.length - 10} more)
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}
