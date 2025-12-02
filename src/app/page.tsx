// src/app/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";

type DashboardItem = {
  id: string;
  sku: string;
  name: string;
  salesPrice?: number;
  standardCost?: number;
  inventoryQty?: number | null;
  reservedQty?: number | null;
  wipQty?: number | null;
  completedQty?: number | null;
  location?: string | null;
};

type ActiveView = "total" | "low" | "value" | "locations";

export default function HomePage() {
  const [items, setItems] = useState<DashboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("total");

  useEffect(() => {
    const loadItems = async () => {
      setLoading(true);
      setError(null);
      try {
        const ref = collection(db, "items");
        const q = query(ref, orderBy("sku"));
        const snapshot = await getDocs(q);
        const rows: DashboardItem[] = snapshot.docs.map((doc) => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            sku: data.sku ?? "",
            name: data.name ?? "",
            salesPrice:
              typeof data.salesPrice === "number" ? data.salesPrice : undefined,
            standardCost:
              typeof data.standardCost === "number"
                ? data.standardCost
                : undefined,
            inventoryQty:
              typeof data.inventoryQty === "number"
                ? data.inventoryQty
                : null,
            reservedQty:
              typeof data.reservedQty === "number" ? data.reservedQty : null,
            wipQty: typeof data.wipQty === "number" ? data.wipQty : null,
            completedQty:
              typeof data.completedQty === "number"
                ? data.completedQty
                : null,
            location:
              (data.location as string) ??
              (data.primaryLocation as string) ??
              null,
          };
        });
        setItems(rows);
      } catch (err: any) {
        console.error("Error loading dashboard items", err);
        setError(err?.message ?? "Error loading dashboard");
      } finally {
        setLoading(false);
      }
    };

    loadItems();
  }, []);

  // Overall stock behind the scenes (Inventory + Reserved + WIP + Completed)
  const getTotalStock = (item: DashboardItem): number => {
    const inv = item.inventoryQty ?? 0;
    const res = item.reservedQty ?? 0;
    const wip = item.wipQty ?? 0;
    const completed = item.completedQty ?? 0;
    return inv + res + wip + completed;
  };

  const totalProducts = items.length;

  // Low stock: still based on overall stock, even though we don't show a "total" column
  const lowStockItems = items.filter((i) => getTotalStock(i) < 10);

  const inventoryValue = items.reduce((sum, item) => {
    const qty = getTotalStock(item);
    const price = item.salesPrice ?? item.standardCost ?? 0;
    return sum + qty * price;
  }, 0);

  const distinctLocations = Array.from(
    new Set(
      items
        .map((i) => (i.location ?? "").trim())
        .filter((v) => v && v.length > 0),
    ),
  );
  const locationCount = distinctLocations.length;

  let tableTitle: string;
  let tableDescription: string;
  let tableItems: DashboardItem[];

  switch (activeView) {
    case "low":
      tableTitle = "Low stock items";
      tableDescription =
        "Products where the overall stock (inventory, reserved, WIP and completed) is fewer than 10 units.";
      tableItems = lowStockItems;
      break;
    case "value":
      tableTitle = "Inventory value by product";
      tableDescription =
        "List price, stock buckets and an approximate inventory value per product.";
      tableItems = items;
      break;
    case "locations":
      tableTitle = "Products by location";
      tableDescription =
        "Products and their primary locations, with stock split by inventory, reserved, WIP and completed.";
      tableItems = items;
      break;
    case "total":
    default:
      tableTitle = "All products & stock buckets";
      tableDescription =
        "Each product with its stock split into Inventory, Reserved, WIP and Completed.";
      tableItems = items;
      break;
  }

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <main className="ims-content">
      <section className="ims-page-header">
        <div>
          <h1 className="ims-page-title">Inventory Dashboard</h1>
          <p className="ims-page-subtitle">
            Monitor stock levels and prepare the backbone for WATR&apos;s
            projects, DAAS, and future quoting flows.
          </p>
        </div>
      </section>

      {/* KPI tiles */}
      <section className="ims-metrics-grid">
        <button
          type="button"
          className={
            "ims-metric-card" +
            (activeView === "total" ? " ims-metric-card--active" : "")
          }
          onClick={() => setActiveView("total")}
          aria-pressed={activeView === "total"}
          data-active={activeView === "total" ? "true" : "false"}
        >
          <div className="ims-metric-icon">📦</div>
          <div className="ims-metric-body">
            <span className="ims-metric-label">Total Products</span>
            <span className="ims-metric-value">
              {loading ? "…" : totalProducts}
            </span>
            <span className="ims-metric-note">
              Products tracked across all stock buckets
            </span>
            <span className="ims-metric-cta">View stock breakdown</span>
          </div>
        </button>

        <button
          type="button"
          className={
            "ims-metric-card" +
            (activeView === "low" ? " ims-metric-card--active" : "")
          }
          onClick={() => setActiveView("low")}
          aria-pressed={activeView === "low"}
          data-active={activeView === "low" ? "true" : "false"}
        >
          <div className="ims-metric-icon ims-metric-icon--warning">⚠️</div>
          <div className="ims-metric-body">
            <span className="ims-metric-label">Low Stock Items</span>
            <span className="ims-metric-value">
              {loading ? "…" : lowStockItems.length}
            </span>
            <span className="ims-metric-note">
              Overall stock &lt; 10 units
            </span>
            <span className="ims-metric-cta">Review low stock</span>
          </div>
        </button>

        <button
          type="button"
          className={
            "ims-metric-card" +
            (activeView === "value" ? " ims-metric-card--active" : "")
          }
          onClick={() => setActiveView("value")}
          aria-pressed={activeView === "value"}
          data-active={activeView === "value" ? "true" : "false"}
        >
          <div className="ims-metric-icon">💰</div>
          <div className="ims-metric-body">
            <span className="ims-metric-label">Inventory Value</span>
            <span className="ims-metric-value">
              {loading ? "…" : formatCurrency(inventoryValue)}
            </span>
            <span className="ims-metric-note">
              Approx. (Inventory + Reserved + WIP + Completed) × price
            </span>
            <span className="ims-metric-cta">Break down by product</span>
          </div>
        </button>

        <button
          type="button"
          className={
            "ims-metric-card" +
            (activeView === "locations" ? " ims-metric-card--active" : "")
          }
          onClick={() => setActiveView("locations")}
          aria-pressed={activeView === "locations"}
          data-active={activeView === "locations" ? "true" : "false"}
        >
          <div className="ims-metric-icon">🏢</div>
          <div className="ims-metric-body">
            <span className="ims-metric-label">Locations</span>
            <span className="ims-metric-value">
              {loading ? "…" : locationCount}
            </span>
            <span className="ims-metric-note">
              Stock, WIP &amp; returns locations
            </span>
            <span className="ims-metric-cta">View by location</span>
          </div>
        </button>
      </section>

      {/* Error / loading messages */}
      {error && (
        <div
          className="ims-alert ims-alert--error"
          style={{ marginTop: "1rem" }}
        >
          {error}
        </div>
      )}

      {/* Table under tiles */}
      <section className="card ims-table-card" style={{ marginTop: "1.5rem" }}>
        <div className="ims-table-header">
          <div>
            <h2 className="ims-form-section-title">{tableTitle}</h2>
            <p className="ims-form-section-subtitle">
              {tableDescription}
            </p>
          </div>
          {!loading && (
            <span className="ims-table-count">
              {tableItems.length} row{tableItems.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {loading ? (
          <p className="ims-table-empty">Loading dashboard data…</p>
        ) : tableItems.length === 0 ? (
          <p className="ims-table-empty">
            No items to display yet. Once you add products and stock, they will
            show here.
          </p>
        ) : (
          <div className="ims-table-wrapper">
            <table className="ims-table">
              <thead>
                {activeView === "total" && (
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Inventory</th>
                    <th>Reserved</th>
                    <th>WIP</th>
                    <th>Completed</th>
                  </tr>
                )}

                {activeView === "low" && (
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Inventory</th>
                    <th>Reserved</th>
                    <th>WIP</th>
                    <th>Completed</th>
                  </tr>
                )}

                {activeView === "value" && (
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Inventory</th>
                    <th>Reserved</th>
                    <th>WIP</th>
                    <th>Completed</th>
                    <th>List price</th>
                    <th>Approx. value</th>
                  </tr>
                )}

                {activeView === "locations" && (
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Location</th>
                    <th>Inventory</th>
                    <th>Reserved</th>
                    <th>WIP</th>
                    <th>Completed</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {tableItems.map((item) => {
                  const totalStock = getTotalStock(item);
                  const price = item.salesPrice ?? item.standardCost ?? 0;
                  const approxValue = totalStock * price;
                  const inv = item.inventoryQty ?? 0;
                  const res = item.reservedQty ?? 0;
                  const wip = item.wipQty ?? 0;
                  const comp = item.completedQty ?? 0;

                  if (activeView === "total" || activeView === "low") {
                    return (
                      <tr key={item.id}>
                        <td>
                          <Link
                            href={`/inventory/${item.id}`}
                            className="ims-table-link"
                          >
                            {item.name}
                          </Link>
                        </td>
                        <td>{item.sku}</td>
                        <td>{inv}</td>
                        <td>{res}</td>
                        <td>{wip}</td>
                        <td>{comp}</td>
                      </tr>
                    );
                  }

                  if (activeView === "value") {
                    return (
                      <tr key={item.id}>
                        <td>
                          <Link
                            href={`/inventory/${item.id}`}
                            className="ims-table-link"
                          >
                            {item.name}
                          </Link>
                        </td>
                        <td>{item.sku}</td>
                        <td>{inv}</td>
                        <td>{res}</td>
                        <td>{wip}</td>
                        <td>{comp}</td>
                        <td>
                          {price > 0 ? formatCurrency(price) : "—"}
                        </td>
                        <td>
                          {approxValue > 0
                            ? formatCurrency(approxValue)
                            : "—"}
                        </td>
                      </tr>
                    );
                  }

                  // locations view
                  return (
                    <tr key={item.id}>
                      <td>
                        <Link
                          href={`/inventory/${item.id}`}
                          className="ims-table-link"
                        >
                          {item.name}
                        </Link>
                      </td>
                      <td>{item.sku}</td>
                      <td>{item.location || "—"}</td>
                      <td>{inv}</td>
                      <td>{res}</td>
                      <td>{wip}</td>
                      <td>{comp}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
