// src/app/project-tracking/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { db } from "@/lib/firebase";
import { getInventoryDetailPath } from "@/lib/inventoryPaths";
import {
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { replenishTrackedProduct } from "@/lib/productTracking";

type ProductTrackingRecord = {
  id: string;
  projectId: string;
  projectName: string;
  itemId: string;
  itemName: string;
  itemType?: string | null;
  quantity: number;
  usefulLifeMonths: number;
  completedAt?: Timestamp | null;
  replaceBy?: Timestamp | null;
  daysRemaining: number | null;
  status: "ok" | "warning" | "overdue" | "replenished";
  replenished?: boolean;
  replenishedAt?: Timestamp | null;
};

const formatDate = (value?: Timestamp | null) => {
  if (!value) return "—";
  try {
    return value.toDate().toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
};

const formatDuration = (months: number) => {
  if (!Number.isFinite(months) || months <= 0) return "—";
  if (months === 1) return "1 month";
  return `${months} months`;
};

export default function ProductTrackingPage() {
  const [records, setRecords] = useState<ProductTrackingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const ref = collection(db, "productTracking");
        const q = query(ref, orderBy("replaceBy", "asc"));
        const snapshot = await getDocs(q);
        const rows: ProductTrackingRecord[] = snapshot.docs.map((doc) => {
          const data = doc.data() as any;
          const replaceBy: Timestamp | null = data.replaceBy ?? null;
          const now = Date.now();
          const daysRemaining =
            replaceBy instanceof Timestamp
              ? Math.ceil(
                  (replaceBy.toMillis() - now) / (1000 * 60 * 60 * 24),
                )
              : null;
          let status: "ok" | "warning" | "overdue" = "ok";
          if (daysRemaining != null) {
            if (daysRemaining <= 0) status = "overdue";
            else if (daysRemaining <= 30) status = "warning";
          }
          return {
            id: doc.id,
            projectId: data.projectId ?? "",
            projectName: data.projectName ?? "Unnamed project",
            itemId: data.itemId ?? "",
            itemName: data.itemName ?? "Unknown item",
            itemType: data.itemType ?? null,
            quantity: typeof data.quantity === "number" ? data.quantity : 0,
            usefulLifeMonths:
              typeof data.usefulLifeMonths === "number"
                ? data.usefulLifeMonths
                : 0,
            completedAt: data.completedAt ?? null,
            replaceBy,
            daysRemaining,
            status,
          };
        });
        setRecords(rows);
      } catch (err: any) {
        console.error("Error loading product tracking", err);
        setError(err?.message ?? "Unable to load product tracking.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const upcoming = useMemo(() => {
    return [...records].sort((a, b) => {
      const aTime =
        a.replaceBy instanceof Timestamp ? a.replaceBy.toMillis() : 0;
      const bTime =
        b.replaceBy instanceof Timestamp ? b.replaceBy.toMillis() : 0;
      return aTime - bTime;
    });
  }, [records]);

  return (
    <main className="ims-content">
      <div className="ims-page-header">
        <div>
          <h1 className="ims-page-title">Product Tracking</h1>
          <p className="ims-page-subtitle">
            Items installed in completed projects with their useful life and
            replacement timelines.
          </p>
        </div>
      </div>

      {actionError && (
        <div className="ims-alert ims-alert--error">{actionError}</div>
      )}

      {error && <div className="ims-alert ims-alert--error">{error}</div>}

      <section className="card ims-table-card">
        <div className="ims-table-header">
          <div>
            <h2 className="ims-form-section-title">Tracked products</h2>
            <span className="ims-table-count">
              {loading
                ? "Loading…"
                : `${records.length} record${records.length === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>

        {loading ? (
          <p className="ims-table-empty">Loading tracked products…</p>
        ) : records.length === 0 ? (
          <p className="ims-table-empty">
            No tracked products yet. Complete projects with items that have a
            useful life to populate this list.
          </p>
        ) : (
          <div className="ims-table-wrapper">
            <table className="ims-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Useful life</th>
                  <th>Completed</th>
                  <th>Replace by</th>
                  <th>Time remaining</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {upcoming.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <Link
                        href={`/projects/${record.projectId}`}
                        className="ims-table-link"
                      >
                        {record.projectName}
                      </Link>
                    </td>
                    <td>
                      <Link
                        href={getInventoryDetailPath(
                          record.itemId,
                          record.itemType,
                        )}
                        className="ims-table-link"
                      >
                        {record.itemName}
                      </Link>
                    </td>
                    <td>{record.quantity}</td>
                    <td>{formatDuration(record.usefulLifeMonths)}</td>
                    <td>{formatDate(record.completedAt)}</td>
                    <td>{formatDate(record.replaceBy)}</td>
                    <td>
                      {record.status === "replenished" ? (
                        <span
                          style={{
                            padding: "0.1rem 0.5rem",
                            borderRadius: "999px",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            color: "#1d4ed8",
                            backgroundColor: "#dbeafe",
                          }}
                        >
                          Replenished
                        </span>
                      ) : record.daysRemaining == null ? (
                        "—"
                      ) : (
                        <span
                          style={{
                            padding: "0.1rem 0.5rem",
                            borderRadius: "999px",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            color:
                              record.status === "overdue"
                                ? "#b91c1c"
                                : record.status === "warning"
                                  ? "#92400e"
                                  : "#065f46",
                            backgroundColor:
                              record.status === "overdue"
                                ? "#fee2e2"
                                : record.status === "warning"
                                  ? "#fffbeb"
                                  : "#ecfdf5",
                          }}
                        >
                          {record.daysRemaining <= 0
                            ? "Due now"
                            : `${record.daysRemaining} days`}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div
                        style={{
                          display: "flex",
                          gap: "0.5rem",
                          justifyContent: "flex-end",
                        }}
                      >
                        <Link
                          href={`/project-tracking/${record.id}`}
                          className="ims-table-link"
                        >
                          View tracking →
                        </Link>
                        <Link
                          href={getInventoryDetailPath(
                            record.itemId,
                            record.itemType,
                          )}
                          className="ims-table-link"
                        >
                          View product →
                        </Link>
                        {!record.replenished && (
                          <button
                            type="button"
                            className="ims-secondary-button"
                            onClick={async () => {
                              setActionError(null);
                              setProcessingId(record.id);
                              try {
                                await replenishTrackedProduct(record.id);
                                const now = Timestamp.now();
                                setRecords((prev) =>
                                  prev.map((rec) =>
                                    rec.id === record.id
                                      ? {
                                          ...rec,
                                          replenished: true,
                                          replenishedAt: now,
                                          status: "replenished",
                                        }
                                      : rec,
                                  ),
                                );
                              } catch (err: any) {
                                console.error(
                                  "Error replenishing product",
                                  err,
                                );
                                setActionError(
                                  err?.message ??
                                    "Unable to replenish this product.",
                                );
                              } finally {
                                setProcessingId(null);
                              }
                            }}
                            disabled={processingId === record.id}
                          >
                            {processingId === record.id
                              ? "Replenishing…"
                              : "Mark replenished"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
