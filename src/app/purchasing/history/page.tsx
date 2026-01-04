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

type PurchaseStatus = "draft" | "sent" | "goods_received";

const normalizeStatus = (value?: string | null): PurchaseStatus => {
  if (value === "goods_received" || value === "stock_received") return "goods_received";
  if (value === "sent" || value === "paid") return "sent";
  return "draft";
};

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
  const [filterText, setFilterText] = useState("");
  const [filterStatus, setFilterStatus] = useState<PurchaseStatus | "all">("all");
  const [sortKey, setSortKey] = useState<
    "vendor-asc" | "vendor-desc" | "date-desc" | "date-asc" | "ref-asc" | "ref-desc"
  >("date-desc");

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
            status: normalizeStatus(data.status),
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
    const now = Timestamp.now();
    const shouldApplyInventory =
      nextStatus === "goods_received" && !purchase.stockAppliedAt;
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
    } catch (err: any) {
      console.error("Error updating purchase status", err);
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const filteredPurchases = useMemo(() => {
    const text = filterText.trim().toLowerCase();
    return purchases
      .filter((purchase) => {
        if (filterStatus !== "all" && purchase.status !== filterStatus) {
          return false;
        }
        if (!text) return true;
        const values = [
          purchase.vendorName,
          purchase.reference ?? "",
          purchase.status,
        ]
          .filter(Boolean)
          .map((v) => v.toString().toLowerCase());
        return values.some((value) => value.includes(text));
      })
      .sort((a, b) => {
        switch (sortKey) {
          case "vendor-asc":
            return a.vendorName.localeCompare(b.vendorName);
          case "vendor-desc":
            return b.vendorName.localeCompare(a.vendorName);
          case "ref-asc":
            return (a.reference ?? "").localeCompare(b.reference ?? "");
          case "ref-desc":
            return (b.reference ?? "").localeCompare(a.reference ?? "");
          case "date-asc":
            return (a.purchaseDate?.toMillis() ?? 0) - (b.purchaseDate?.toMillis() ?? 0);
          case "date-desc":
          default:
            return (b.purchaseDate?.toMillis() ?? 0) - (a.purchaseDate?.toMillis() ?? 0);
        }
      });
  }, [purchases, filterStatus, filterText, sortKey]);

  return (
    <main className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Purchase history</h1>
          <p className="ims-page-subtitle">
            A record of every logged purchase with quick filters and sorting.
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
                : `${filteredPurchases.length} of ${purchases.length} purchase${
                    purchases.length === 1 ? "" : "s"
                  }`}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <input
              type="text"
              className="ims-field-input"
              placeholder="Filter by vendor, reference, or status…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={{ minWidth: "220px" }}
            />
            <select
              className="ims-field-input"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as PurchaseStatus | "all")}
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="goods_received">Goods received</option>
            </select>
            <select
              className="ims-field-input"
              value={sortKey}
              onChange={(e) =>
                setSortKey(
                  e.target.value as
                    | "vendor-asc"
                    | "vendor-desc"
                    | "date-desc"
                    | "date-asc"
                    | "ref-asc"
                    | "ref-desc",
                )
              }
            >
              <option value="date-desc">Newest first</option>
              <option value="date-asc">Oldest first</option>
              <option value="vendor-asc">Vendor A–Z</option>
              <option value="vendor-desc">Vendor Z–A</option>
              <option value="ref-asc">Reference A–Z</option>
              <option value="ref-desc">Reference Z–A</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p className="ims-table-empty">Loading purchase history…</p>
        ) : filteredPurchases.length === 0 ? (
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPurchases.map((purchase) => (
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
                    <td style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <Link
                        href={`/purchasing/${purchase.id}`}
                        className="ims-secondary-button"
                        style={{ padding: "0.35rem 0.65rem", fontSize: "0.82rem" }}
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/purchasing/${purchase.id}`}
                        className="ims-table-link"
                      >
                        View →
                      </Link>
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
