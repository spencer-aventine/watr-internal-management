"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
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
  totalAmount?: number | null;
  createdAt?: Timestamp | null;
  notes?: string | null;
  lineItems: PurchaseLine[];
  status: PurchaseStatus;
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
            totalAmount:
              typeof data.totalAmount === "number" ? data.totalAmount : null,
            createdAt: data.createdAt ?? null,
            notes: data.notes ?? null,
            lineItems: Array.isArray(data.lineItems) ? data.lineItems : [],
            status: (data.status as PurchaseStatus) ?? "draft",
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
    </main>
  );
}
