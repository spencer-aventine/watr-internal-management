// src/app/inventory/sub-assemblies/pipeline/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  increment,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { fetchWarehouseLocations } from "@/lib/warehouseLocations";
import { useAuth } from "@/app/_components/AuthProvider";

type ComponentRow = {
  id: string;
  name: string;
  perAssembly: number;
  perRun: number;
  available: number | null;
};

type AssemblyRecord = {
  id: string;
  name: string;
  sku?: string | null;
  owner?: string | null;
  storageLocation?: string | null;
  plannedQuantity: number;
  components: ComponentRow[];
  dueDate?: Date | null;
};

export default function SubAssemblyManufacturePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { canEdit } = useAuth();
  const assemblyId = params.id;

  const [record, setRecord] = useState<AssemblyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locations, setLocations] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadLocations = async () => {
      const opts = await fetchWarehouseLocations();
      setLocations(opts);
    };
    loadLocations();
  }, []);

  useEffect(() => {
    const loadAssembly = async () => {
      if (!assemblyId) return;
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const snap = await getDoc(doc(db, "items", assemblyId));
        if (!snap.exists()) {
          setRecord(null);
          setError("Sub-assembly not found.");
          return;
        }
        const data = snap.data() as any;
        const plannedQuantity =
          typeof data.manufacturePlannedQty === "number" && data.manufacturePlannedQty > 0
            ? data.manufacturePlannedQty
            : 1;
        const componentEntries: Array<Record<string, unknown>> = Array.isArray(data.components)
          ? data.components
          : [];
        const normalized: Array<{ componentId: string; perAssembly: number }> = componentEntries
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
          .filter(
            (entry): entry is { componentId: string; perAssembly: number } =>
              Boolean(entry),
          );

        let components: ComponentRow[] = [];
        if (normalized.length) {
          const snaps = await Promise.all(
            normalized.map((entry) => getDoc(doc(db, "items", entry.componentId))),
          );
          components = snaps
            .map((componentSnap, idx) => {
              const ref = normalized[idx];
              if (!componentSnap.exists()) return null;
              const cData = componentSnap.data() as any;
              const available = Number(cData.inventoryQty);
              return {
                id: componentSnap.id,
                name: cData.name ?? cData.sku ?? "Component",
                perAssembly: ref.perAssembly,
                perRun: ref.perAssembly * plannedQuantity,
                available: Number.isFinite(available) ? available : null,
              };
            })
            .filter((row): row is ComponentRow => Boolean(row));
        }

        setRecord({
          id: snap.id,
          name: data.name ?? data.sku ?? "Sub-assembly",
          sku: data.sku ?? data.shortCode ?? null,
          owner: data.subAssemblyOwner ?? data.owner ?? null,
          storageLocation: data.storageLocation ?? null,
          plannedQuantity,
          components,
          dueDate:
            data.dueDate instanceof Timestamp
              ? data.dueDate.toDate()
              : typeof data.dueDate?.toDate === "function"
                ? data.dueDate.toDate()
                : data.dueDate
                  ? new Date(data.dueDate)
                  : null,
        });
      } catch (err: any) {
        console.error("Error loading manufacture record", err);
        setError(err?.message ?? "Unable to load this manufacture.");
        setRecord(null);
      } finally {
        setLoading(false);
      }
    };

    loadAssembly();
  }, [assemblyId]);

  const handleMarkComplete = async () => {
    if (!record) return;
    if (!canEdit) {
      setError("You do not have permission to perform this action.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const qty = record.plannedQuantity || 0;
      await updateDoc(doc(db, "items", record.id), {
        manufactureStatus: "manufacture_complete",
        wipQty: increment(-qty),
        completedQty: increment(qty),
        updatedAt: Timestamp.now(),
      });
      setMessage("Marked as manufacture complete and moved in the pipeline.");
      router.push("/inventory/sub-assemblies/pipeline");
    } catch (err: any) {
      console.error("Error marking manufacture complete", err);
      setError(err?.message ?? "Unable to mark this manufacture as complete.");
    } finally {
      setSaving(false);
    }
  };

  const locationLabel = useMemo(() => {
    if (!record?.storageLocation) return "—";
    if (locations.includes(record.storageLocation)) return record.storageLocation;
    return record.storageLocation;
  }, [record?.storageLocation, locations]);

  return (
    <main className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Sub-assembly manufacture</h1>
          <p className="ims-page-subtitle">
            Review the components and details for this manufacturing run before completion.
          </p>
        </div>
        <div className="ims-page-actions" style={{ gap: "0.5rem" }}>
          <Link href="/inventory/sub-assemblies/pipeline" className="ims-secondary-button">
            ← Back to pipeline
          </Link>
          <button
            type="button"
            className="ims-primary-button"
            onClick={handleMarkComplete}
            disabled={saving || !record || !canEdit}
          >
            {saving ? "Updating…" : "Confirm manufacture complete"}
          </button>
        </div>
      </div>

      {(error || message) && (
        <div
          className={"ims-alert " + (error ? "ims-alert--error" : "ims-alert--info")}
          style={{ maxWidth: 760 }}
        >
          {error || message}
        </div>
      )}

      {loading ? (
        <section className="ims-form-section card">
          <p className="ims-table-empty">Loading manufacture details…</p>
        </section>
      ) : !record ? (
        <section className="ims-form-section card">
          <p className="ims-table-empty">
            Manufacture not found. Return to the pipeline to select another.
          </p>
        </section>
      ) : (
        <div className="ims-form-stack" style={{ gap: "1rem" }}>
          <section className="ims-form-section card">
            <div className="ims-table-header">
              <div>
                <h2 className="ims-form-section-title">{record.name}</h2>
                {record.sku && (
                  <p className="ims-form-section-subtitle" style={{ marginBottom: 0 }}>
                    SKU: {record.sku}
                  </p>
                )}
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "0.75rem",
              }}
            >
              <div
                className="card"
                style={{
                  padding: "0.7rem 0.85rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.1rem",
                }}
              >
                <div className="ims-metric-label" style={{ fontSize: "0.82rem" }}>
                  Units in this run
                </div>
                <div className="ims-metric-value" style={{ fontSize: "1.2rem" }}>
                  {record.plannedQuantity}
                </div>
              </div>
              <div
                className="card"
                style={{
                  padding: "0.7rem 0.85rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.1rem",
                }}
              >
                <div className="ims-metric-label" style={{ fontSize: "0.82rem" }}>
                  Owner
                </div>
                <div
                  className="ims-metric-value"
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {record.owner || <span className="ims-table-empty">Unassigned</span>}
                </div>
              </div>
              <div
                className="card"
                style={{
                  padding: "0.7rem 0.85rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.1rem",
                }}
              >
                <div className="ims-metric-label" style={{ fontSize: "0.82rem" }}>
                  Location
                </div>
                <div
                  className="ims-metric-value"
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {locationLabel}
                </div>
              </div>
              <div
                className="card"
                style={{
                  padding: "0.7rem 0.85rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.1rem",
                }}
              >
                <div className="ims-metric-label" style={{ fontSize: "0.82rem" }}>
                  Due date
                </div>
                <div
                  className="ims-metric-value"
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {record.dueDate ? record.dueDate.toLocaleDateString() : "—"}
                </div>
              </div>
            </div>
          </section>

          <section className="ims-form-section card">
            <div className="ims-table-header">
              <div>
                <h2 className="ims-form-section-title">Components needed</h2>
                <p className="ims-form-section-subtitle">
                  Quantities include the total required for this manufacturing run.
                </p>
              </div>
            </div>
            {record.components.length === 0 ? (
              <p className="ims-table-empty">
                No component criteria found for this assembly.
              </p>
            ) : (
              <div className="ims-table-wrapper">
                <table className="ims-table ims-table--compact">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th>Per assembly</th>
                      <th>Total for run</th>
                      <th>Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.components.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>{row.perAssembly}</td>
                        <td>{row.perRun}</td>
                        <td>{row.available != null ? row.available : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
