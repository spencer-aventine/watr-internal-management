"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
  doc,
  updateDoc,
  writeBatch,
  increment,
} from "firebase/firestore";

type PurchaseLine = {
  itemId?: string | null;
  sku?: string | null;
  name?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
};

type PurchaseRecord = {
  id: string;
  vendorName: string;
  reference?: string | null;
  purchaseDate?: Timestamp | null;
  proposedDeliveryDate?: Timestamp | null;
  totalAmount?: number | null;
  createdAt?: Timestamp | null;
  notes?: string | null;
  lineItems: PurchaseLine[];
  status: PurchaseStatus;
  stockAppliedAt?: Timestamp | null;
};

type PurchaseStatus = "draft" | "paid" | "stock_received";

const formatCurrency = (value?: number | null) => {
  if (value == null || Number.isNaN(value)) return "—";
  return `£${value.toFixed(2)}`;
};

const formatDate = (timestamp?: Timestamp | null) => {
  if (!timestamp) return "—";
  try {
    return timestamp.toDate().toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
};

export default function PurchaseHistoryPage() {
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const ref = collection(db, "purchases");
        const q = query(ref, orderBy("purchaseDate", "desc"));
        const snapshot = await getDocs(q);

        const rows: PurchaseRecord[] = snapshot.docs.map((doc) => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            vendorName: data.vendorName ?? "Unknown vendor",
            reference: data.reference ?? null,
            purchaseDate: data.purchaseDate ?? data.createdAt ?? null,
            proposedDeliveryDate: data.proposedDeliveryDate ?? null,
            totalAmount:
              typeof data.totalAmount === "number" ? data.totalAmount : null,
            createdAt: data.createdAt ?? null,
            notes: data.notes ?? null,
            lineItems: Array.isArray(data.lineItems) ? data.lineItems : [],
            status: (data.status as PurchaseStatus) ?? "draft",
            stockAppliedAt: data.stockAppliedAt ?? null,
          };
        });

        setPurchases(rows);
      } catch (err) {
        console.error("Error loading purchases", err);
        setError("Unable to load purchase history.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const purchaseStatuses: PurchaseStatus[] = ["draft", "paid", "stock_received"];

  const toIsoDate = (timestamp?: Timestamp | null) => {
    if (!timestamp) return null;
    try {
      return timestamp.toDate().toISOString().split("T")[0];
    } catch {
      return null;
    }
  };

  const calendarDays = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 14 }, (_, idx) => {
      const date = new Date(start);
      date.setDate(start.getDate() + idx);
      return {
        iso: date.toISOString().split("T")[0],
        label: date.toLocaleDateString(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
        }),
      };
    });
  }, []);

  const deliveriesByDay = useMemo(() => {
    const map = new Map<string, PurchaseRecord[]>();
    purchases.forEach((purchase) => {
      const iso = toIsoDate(purchase.proposedDeliveryDate);
      const key = iso ?? "unscheduled";
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(purchase);
    });
    return map;
  }, [purchases]);

  const unscheduledPurchases = deliveriesByDay.get("unscheduled") ?? [];

  const applyInventoryFromPurchase = async (
    purchase: PurchaseRecord,
    timestamp: Timestamp,
  ) => {
    const quantityMap = new Map<string, number>();
    purchase.lineItems.forEach((line) => {
      const itemId = line.itemId;
      if (!itemId) return;
      const qty =
        typeof line.quantity === "number" && line.quantity > 0
          ? line.quantity
          : null;
      if (!qty) return;
      quantityMap.set(itemId, (quantityMap.get(itemId) ?? 0) + qty);
    });
    if (quantityMap.size === 0) return;
    const batch = writeBatch(db);
    quantityMap.forEach((qty, itemId) => {
      batch.update(doc(db, "items", itemId), {
        inventoryQty: increment(qty),
        updatedAt: timestamp,
      });
    });
    await batch.commit();
  };

  const handleStatusUpdate = async (
    purchase: PurchaseRecord,
    nextStatus: PurchaseStatus,
  ) => {
    if (purchase.status === nextStatus) return;
    setStatusUpdatingId(purchase.id);
    setCalendarMessage(null);
    setCalendarError(null);
    const now = Timestamp.now();
    const shouldApplyInventory =
      nextStatus === "stock_received" && !purchase.stockAppliedAt;
    try {
      if (shouldApplyInventory) {
        await applyInventoryFromPurchase(purchase, now);
      }
      await updateDoc(doc(db, "purchases", purchase.id), {
        status: nextStatus,
        updatedAt: now,
        ...(shouldApplyInventory ? { stockAppliedAt: now } : {}),
      });
      setPurchases((prev) =>
        prev.map((row) =>
          row.id === purchase.id
            ? {
                ...row,
                status: nextStatus,
                stockAppliedAt: shouldApplyInventory
                  ? now
                  : row.stockAppliedAt,
              }
            : row,
        ),
      );
      setCalendarMessage("Purchase status updated.");
    } catch (err: any) {
      console.error("Error updating purchase status", err);
      setCalendarError(err?.message ?? "Unable to update purchase status.");
    } finally {
      setStatusUpdatingId(null);
    }
  };

  return (
    <main className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Purchase history</h1>
          <p className="ims-page-subtitle">
            A record of every logged purchase, sortable by newest first.
          </p>
        </div>
        <div className="ims-page-actions">
          <Link href="/purchasing" className="ims-secondary-button">
            + Log new purchase
          </Link>
        </div>
      </div>

      {error && <div className="ims-alert ims-alert--error">{error}</div>}

      <section className="card ims-table-card">
        <div className="ims-table-header">
          <div>
            <h2 className="ims-form-section-title">All purchases</h2>
            <span className="ims-table-count">
              {loading
                ? "Loading…"
                : `${purchases.length} purchase${
                    purchases.length === 1 ? "" : "s"
                  }`}
            </span>
          </div>
        </div>

        {loading ? (
          <p className="ims-table-empty">Loading purchase history…</p>
        ) : purchases.length === 0 ? (
          <p className="ims-table-empty">
            No purchases logged yet. Record your first purchase to populate this
            list.
          </p>
        ) : (
          <div className="ims-table-wrapper">
            <table className="ims-table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Reference</th>
                  <th>Date</th>
                  <th>Proposed delivery</th>
                  <th>Status</th>
                  <th>Lines</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {purchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td>{purchase.vendorName}</td>
                    <td>{purchase.reference || "—"}</td>
                    <td>{formatDate(purchase.purchaseDate)}</td>
                    <td>{formatDate(purchase.proposedDeliveryDate)}</td>
                    <td style={{ textTransform: "capitalize" }}>
                      {purchase.status.replace("_", " ")}
                    </td>
                    <td>{purchase.lineItems.length}</td>
                    <td>{formatCurrency(purchase.totalAmount)}</td>
                    <td>
                      <Link
                        href={`/purchasing/${purchase.id}`}
                        className="ims-table-link"
                      >
                        View details →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card ims-form-section" style={{ marginTop: "1.5rem" }}>
        <div className="ims-table-header">
          <div>
            <h2 className="ims-form-section-title">Delivery calendar</h2>
            <p className="ims-form-section-subtitle">
              Proposed deliveries over the next two weeks with quick status updates.
            </p>
          </div>
        </div>
        {(calendarError || calendarMessage) && (
          <div
            className={
              "ims-alert " +
              (calendarError ? "ims-alert--error" : "ims-alert--info")
            }
            style={{ marginBottom: "0.75rem" }}
          >
            {calendarError || calendarMessage}
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "1rem",
          }}
        >
          {calendarDays.map((day) => {
            const dayPurchases = deliveriesByDay.get(day.iso) ?? [];
            return (
              <div key={day.iso} className="card" style={{ padding: "1rem" }}>
                <div className="ims-field-label" style={{ marginBottom: "0.35rem" }}>
                  {day.label}
                </div>
                {dayPurchases.length === 0 ? (
                  <p className="ims-table-empty" style={{ margin: 0 }}>
                    No deliveries.
                  </p>
                ) : (
                  dayPurchases.map((purchase) => {
                    const isUpdating = statusUpdatingId === purchase.id;
                    return (
                      <div
                        key={purchase.id}
                        style={{
                          borderTop: "1px solid var(--color-border)",
                          paddingTop: "0.65rem",
                          marginTop: "0.65rem",
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {purchase.vendorName}
                        </div>
                        <div style={{ fontSize: "0.85rem", color: "#4b5563" }}>
                          Ref {purchase.reference || "—"} ·{" "}
                          {purchase.lineItems.length} line
                          {purchase.lineItems.length === 1 ? "" : "s"}
                        </div>
                        <div className="ims-field" style={{ marginTop: "0.35rem" }}>
                          <label
                            className="ims-field-label"
                            htmlFor={`status-${purchase.id}`}
                          >
                            Status
                          </label>
                          <select
                            id={`status-${purchase.id}`}
                            className="ims-field-input"
                            value={purchase.status}
                            onChange={(e) =>
                              handleStatusUpdate(
                                purchase,
                                e.target.value as PurchaseStatus,
                              )
                            }
                            disabled={isUpdating}
                          >
                            {purchaseStatuses.map((status) => (
                              <option key={status} value={status}>
                                {status.replace("_", " ")}
                              </option>
                            ))}
                          </select>
                        </div>
                        <Link
                          href={`/purchasing/${purchase.id}`}
                          className="ims-table-link"
                          style={{ fontSize: "0.85rem" }}
                        >
                          View details →
                        </Link>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
          {unscheduledPurchases.length > 0 && (
            <div className="card" style={{ padding: "1rem" }}>
              <div className="ims-field-label" style={{ marginBottom: "0.35rem" }}>
                No delivery date
              </div>
              {unscheduledPurchases.map((purchase) => {
                const isUpdating = statusUpdatingId === purchase.id;
                return (
                  <div
                    key={purchase.id}
                    style={{
                      borderTop: "1px solid var(--color-border)",
                      paddingTop: "0.65rem",
                      marginTop: "0.65rem",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{purchase.vendorName}</div>
                    <div style={{ fontSize: "0.85rem", color: "#4b5563" }}>
                      Ref {purchase.reference || "—"}
                    </div>
                    <div className="ims-field" style={{ marginTop: "0.35rem" }}>
                      <label
                        className="ims-field-label"
                        htmlFor={`status-${purchase.id}-unscheduled`}
                      >
                        Status
                      </label>
                      <select
                        id={`status-${purchase.id}-unscheduled`}
                        className="ims-field-input"
                        value={purchase.status}
                        onChange={(e) =>
                          handleStatusUpdate(
                            purchase,
                            e.target.value as PurchaseStatus,
                          )
                        }
                        disabled={isUpdating}
                      >
                        {purchaseStatuses.map((status) => (
                          <option key={status} value={status}>
                            {status.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Link
                      href={`/purchasing/${purchase.id}`}
                      className="ims-table-link"
                      style={{ fontSize: "0.85rem" }}
                    >
                      View details →
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
