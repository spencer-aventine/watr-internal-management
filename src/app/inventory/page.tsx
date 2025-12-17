// src/app/inventory/page.tsx
"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  addDoc,
  Timestamp,
  query,
  orderBy,
  deleteDoc,
} from "firebase/firestore";
import {
  getInventoryDetailPath,
  normalizeItemType,
} from "@/lib/inventoryPaths";

type FirestoreItem = {
  id: string;
  name: string;
  itemType?: string;
  supplier1?: string;
  supplier2?: string;
  shortCode?: string;
  pricePerUnit?: number;
  quantity?: number;
  totalCost?: number;
  status?: string;
};

type CsvRow = {
  [key: string]: any;
};

type ImportRow = {
  name: string;
  type: string;
  supplier1: string;
  supplier2: string;
  shortCode: string;
  pricePerUnit: number;
  quantity: number;
  totalCost: number;
};

// Keys used in the table — update this union + allColumns to add/remove columns
type ColumnKey =
  | "name"
  | "itemType"
  | "supplier1"
  | "supplier2"
  | "shortCode"
  | "pricePerUnit"
  | "quantity"
  | "totalCost"
  | "status";

type ColumnConfig = {
  key: ColumnKey;
  label: string;
};

type TabKey =
  | "all"
  | "products"
  | "subAssemblies"
  | "components"
  | "sensors"
  | "sensorExtras";

const tabOptions: { key: TabKey; label: string }[] = [
  { key: "all", label: "All items" },
  { key: "products", label: "Products" },
  { key: "subAssemblies", label: "Sub-assemblies" },
  { key: "components", label: "Components" },
  { key: "sensors", label: "Sensors" },
  { key: "sensorExtras", label: "Sensor extras" },
];

const creationTabOptions = tabOptions.filter(
  (tab): tab is { key: Exclude<TabKey, "all">; label: string } =>
    tab.key !== "all",
);

const createPaths: Record<Exclude<TabKey, "all">, string> = {
  products: "/inventory/new?type=products",
  subAssemblies: "/inventory/sub-assemblies/new",
  components: "/inventory/new?type=components",
  sensors: "/inventory/new?type=sensors",
  sensorExtras: "/inventory/new?type=sensorExtras",
};

// Single source of truth for columns
const allColumns: ColumnConfig[] = [
  { key: "name", label: "Name" },
  { key: "itemType", label: "Type" },
  { key: "supplier1", label: "Supplier 1" },
  { key: "supplier2", label: "Supplier 2" },
  { key: "shortCode", label: "Short code" },
  { key: "pricePerUnit", label: "Price per unit" },
  { key: "quantity", label: "Qty" },
  { key: "totalCost", label: "Total cost" },
  { key: "status", label: "Status" },
];

const getTabKeyForItem = (item: FirestoreItem): TabKey => {
  const type = normalizeItemType(item.itemType);

  if (
    type === "product" ||
    type === "products" ||
    type === "unit" ||
    type === "finished good"
  ) {
    return "products";
  }

  if (
    type === "sub assembly" ||
    type === "sub assemblies" ||
    type === "subassembly"
  ) {
    return "subAssemblies";
  }

  if (type === "sensor" || type === "sensors" || type === "data") {
    return "sensors";
  }

  if (type === "sensor extra" || type === "sensor extras") {
    return "sensorExtras";
  }

  return "components";
};

const matchesTab = (item: FirestoreItem, tab: TabKey) =>
  getTabKeyForItem(item) === tab;

const mapCsvRow = (row: CsvRow): ImportRow | null => {
  const name = String(row["Name"] ?? "").trim();
  const typeValue = String(row["Type"] ?? "component").trim();
  const type = typeValue || "component";
  const supplier1 = String(row["Supplier 1"] ?? "").trim();
  const supplier2 = String(row["Supplier 2"] ?? "").trim();
  const shortCode = String(row["ShortCode"] ?? "").trim();
  if (!name) return null;

  const parseNumber = (value: any): number => {
    if (value == null) return 0;
    const normalized = String(value).replace(/,/g, "");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  };

  return {
    name,
    type,
    supplier1,
    supplier2,
    shortCode,
    pricePerUnit: parseNumber(row["Price per unit"]),
    quantity: parseNumber(row["Qty"]),
    totalCost: parseNumber(row["Total cost"]),
  };
};

export default function InventoryPage() {
  const [items, setItems] = useState<FirestoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importPreview, setImportPreview] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>("all");
  // Table filtering
  const [filterText, setFilterText] = useState("");
  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(
    allColumns.map((c) => c.key),
  );
  // Column menu UI
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [draftColumns, setDraftColumns] = useState<ColumnKey[]>(
    allColumns.map((c) => c.key),
  );

  const loadItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const ref = collection(db, "items");
      const q = query(ref, orderBy("name"));
      const snapshot = await getDocs(q);
        const rows: FirestoreItem[] = snapshot.docs.map((doc) => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            name: data.name ?? "",
            itemType: data.itemType ?? data.rawCsvItemType ?? "",
            supplier1: data.supplier1 ?? "",
            supplier2: data.supplier2 ?? "",
            shortCode: data.shortCode ?? data.sku ?? "",
            pricePerUnit:
              typeof data.pricePerUnit === "number"
                ? data.pricePerUnit
                : typeof data.standardCost === "number"
                  ? data.standardCost
                  : undefined,
            quantity:
              typeof data.quantity === "number"
                ? data.quantity
                : typeof data.inventoryQty === "number"
                  ? data.inventoryQty
                  : undefined,
            totalCost:
              typeof data.totalCost === "number"
                ? data.totalCost
                : undefined,
            status: data.status ?? "active",
          };
        });
      setItems(rows);
    } catch (err: any) {
      console.error("Error loading items", err);
      setError(err?.message ?? "Error loading items");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage(null);
    setError(null);

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const mapped = results.data
          .map(mapCsvRow)
          .filter((row): row is ImportRow => row !== null);
        setImportPreview(mapped);
        if (mapped.length === 0) {
          setMessage("No valid rows found in CSV (check headers).");
        } else {
          setMessage(
            `Loaded ${mapped.length} rows from CSV. Review and import.`,
          );
        }
      },
      error: (err) => {
        console.error("CSV parse error", err);
        setError(err.message);
      },
    });
  };

  const handleImport = async () => {
    if (!importPreview.length) return;
    setImporting(true);
    setError(null);
    setMessage(null);

    try {
      const now = Timestamp.now();
      const itemsRef = collection(db, "items");
      const existingSnapshot = await getDocs(itemsRef);
      await Promise.all(existingSnapshot.docs.map((doc) => deleteDoc(doc.ref)));

      for (const row of importPreview) {
        const itemType = row.type || "component";
        const totalCost =
          row.totalCost > 0
            ? row.totalCost
            : row.pricePerUnit * (row.quantity || 0);

        await addDoc(itemsRef, {
          sku: row.shortCode || row.name,
          shortCode: row.shortCode || row.name,
          name: row.name,
          shortName: row.name,
          description: null,
          supplier1: row.supplier1 || null,
          supplier2: row.supplier2 || null,
          itemType,
          rawCsvItemType: row.type || "",
          unitOfMeasure: "ea",
          status: "active",
          pricePerUnit: row.pricePerUnit,
          standardCost: row.pricePerUnit,
          standardCostCurrency: "GBP",
          quantity: row.quantity,
          inventoryQty: row.quantity,
          totalCost,
          createdByUserId: "system",
          createdAt: now,
          updatedAt: now,
        });
      }

      setMessage(
        `Cleared ${existingSnapshot.size} existing items and imported ${importPreview.length} new records.`,
      );
      setImportPreview([]);
      await loadItems();
    } catch (err: any) {
      console.error("Error importing items", err);
      setError(err?.message ?? "Error importing items");
    } finally {
      setImporting(false);
    }
  };

  // Column visibility logic
  const toggleDraftColumn = (key: ColumnKey) => {
    setDraftColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const openColumnMenu = () => {
    setDraftColumns(visibleColumns);
    setShowColumnMenu(true);
  };

  const applyColumnSelection = () => {
    setVisibleColumns(draftColumns.length ? draftColumns : ["shortCode", "name"]);
    setShowColumnMenu(false);
  };

  const resetColumns = () => {
    const all = allColumns.map((c) => c.key);
    setDraftColumns(all);
    setVisibleColumns(all);
    setShowColumnMenu(false);
  };

  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = {
      all: 0,
      products: 0,
      subAssemblies: 0,
      components: 0,
      sensors: 0,
      sensorExtras: 0,
    };
    items.forEach((item) => {
      const match = tabOptions.find((tab) => matchesTab(item, tab.key));
      if (match) {
        counts[match.key] += 1;
      }
    });
    counts.all = items.length;
    return counts;
  }, [items]);

  const itemsForActiveTab = useMemo(() => {
    if (activeTab === "all") return items;
    return items.filter((item) => matchesTab(item, activeTab));
  }, [items, activeTab]);

  const activeTabLabel =
    tabOptions.find((tab) => tab.key === activeTab)?.label ?? "Products";

  // Apply text filter
  const filteredItems = (() => {
    const text = filterText.trim().toLowerCase();
    if (!text) return itemsForActiveTab;

    return itemsForActiveTab.filter((p) => {
      const values = [
        p.name,
        p.itemType,
        p.supplier1,
        p.supplier2,
        p.shortCode,
        p.status,
      ]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());

      return values.some((v) => v.includes(text));
    });
  })();

  const visibleColumnConfigs = allColumns.filter((c) =>
    visibleColumns.includes(c.key),
  );

  return (
    <main className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Inventory</h1>
          <p className="ims-page-subtitle">
            Browse products, sub-assemblies, components, sensors, and sensor
            extras in the WATR inventory master. Use the CSV import to seed
            new records from your configurator list.
          </p>
        </div>
        <div className="ims-page-actions">
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.35rem",
              marginBottom: "0.5rem",
            }}
          >
            {creationTabOptions.map((tab) => (
              <Link
                key={tab.key}
                href={createPaths[tab.key]}
                className="ims-secondary-button"
                style={{ fontSize: "0.8rem" }}
              >
                + Add {tab.label}
              </Link>
            ))}
          </div>
          <label className="ims-secondary-button ims-file-label">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            Upload CSV
          </label>
          {importPreview.length > 0 && (
              <button
                className="ims-primary-button"
                onClick={handleImport}
                disabled={importing}
              >
                {importing
                  ? "Importing…"
                  : `Import ${importPreview.length} items`}
              </button>
            )}
        </div>
      </div>

      <div className="ims-tab-bar">
        {tabOptions.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              className={
                "ims-tab-button" + (isActive ? " ims-tab-button--active" : "")
              }
              onClick={() => setActiveTab(tab.key)}
              aria-pressed={isActive}
            >
              <span>{tab.label}</span>
              <span className="ims-tab-count">{tabCounts[tab.key]}</span>
            </button>
          );
        })}
      </div>

      {/* Messages */}
      {(message || error) && (
        <div
          className={
            "ims-alert " + (error ? "ims-alert--error" : "ims-alert--info")
          }
        >
          {error || message}
        </div>
      )}

      {/* Inventory table */}
      <section className="card ims-table-card">
        <div className="ims-table-header" style={{ alignItems: "flex-start" }}>
          <div>
            <h2 className="ims-form-section-title">{activeTabLabel}</h2>
            <span className="ims-table-count">
              {loading
                ? "Loading…"
                : `${filteredItems.length} of ${itemsForActiveTab.length} ${
                    itemsForActiveTab.length === 1 ? "item" : "items"
                  }`}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              alignItems: "flex-end",
              position: "relative",
            }}
          >
            {/* Filter input */}
            <input
              type="text"
              placeholder="Filter by name, type, supplier, code..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="ims-field-input"
              style={{ minWidth: "260px" }}
            />

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="ims-secondary-button"
                onClick={openColumnMenu}
              >
                Edit columns
              </button>
            </div>

            {/* Column menu popover */}
            {showColumnMenu && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: "0.5rem",
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  backgroundColor: "#ffffff",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 10px 30px rgba(15,23,42,0.18)",
                  minWidth: "220px",
                  zIndex: 20,
                }}
              >
                <div
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.5rem",
                  }}
                >
                  Visible columns
                </div>
                <div
                  style={{
                    maxHeight: "220px",
                    overflowY: "auto",
                    paddingRight: "0.25rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  {allColumns.map((col) => (
                    <label
                      key={col.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        fontSize: "0.8rem",
                        padding: "0.2rem 0",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={draftColumns.includes(col.key)}
                        onChange={() => toggleDraftColumn(col.key)}
                      />
                      <span>{col.label}</span>
                    </label>
                  ))}
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    marginTop: "0.25rem",
                  }}
                >
                  <button
                    type="button"
                    className="ims-secondary-button"
                    style={{ paddingInline: "0.75rem", fontSize: "0.8rem" }}
                    onClick={resetColumns}
                  >
                    Reset
                  </button>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button
                      type="button"
                      className="ims-secondary-button"
                      style={{ paddingInline: "0.75rem", fontSize: "0.8rem" }}
                      onClick={() => setShowColumnMenu(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="ims-primary-button"
                      style={{ paddingInline: "0.75rem", fontSize: "0.8rem" }}
                      onClick={applyColumnSelection}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {filteredItems.length === 0 && !loading ? (
          <p className="ims-table-empty">
            No {activeTabLabel.toLowerCase()} match this filter or tab. Try
            clearing the filter or import from CSV.
          </p>
        ) : (
          <div className="ims-table-wrapper">
            <table className="ims-table">
              <thead>
                <tr>
                  {visibleColumnConfigs.map((col) => (
                    <th key={col.key}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((p) => (
                  <tr key={p.id}>
                    {visibleColumnConfigs.map((col) => {
                      switch (col.key) {
                        case "name":
                          return (
                            <td key={col.key}>
                              <Link
                                href={getInventoryDetailPath(
                                  p.id,
                                  p.itemType,
                                )}
                                className="ims-table-link"
                              >
                                {p.name}
                              </Link>
                            </td>
                          );
                        case "itemType":
                          return (
                            <td key={col.key}>{p.itemType || "–"}</td>
                          );
                        case "supplier1":
                          return (
                            <td key={col.key}>{p.supplier1 || "–"}</td>
                          );
                        case "supplier2":
                          return (
                            <td key={col.key}>{p.supplier2 || "–"}</td>
                          );
                        case "shortCode":
                          return (
                            <td key={col.key}>{p.shortCode || "–"}</td>
                          );
                        case "pricePerUnit":
                          return (
                            <td key={col.key}>
                              {p.pricePerUnit != null
                                ? `£${p.pricePerUnit.toFixed(2)}`
                                : "–"}
                            </td>
                          );
                        case "quantity":
                          return (
                            <td key={col.key}>
                              {p.quantity != null ? p.quantity : "–"}
                            </td>
                          );
                        case "totalCost":
                          return (
                            <td key={col.key}>
                              {p.totalCost != null
                                ? `£${p.totalCost.toFixed(2)}`
                                : "–"}
                            </td>
                          );
                        case "status":
                          return (
                            <td key={col.key}>
                              <span
                                className={
                                  "ims-status-tag " +
                                  (p.status === "active"
                                    ? "ims-status-tag--active"
                                    : "ims-status-tag--inactive")
                                }
                              >
                                {p.status ?? "unknown"}
                              </span>
                            </td>
                          );
                        default:
                          return null;
                      }
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Import preview */}
      {importPreview.length > 0 && (
        <section className="card ims-table-card ims-table-card--secondary">
          <div className="ims-table-header">
            <h2 className="ims-form-section-title">Import preview</h2>
            <span className="ims-table-count">
              {importPreview.length} rows from CSV
            </span>
          </div>
          <div className="ims-table-wrapper">
            <table className="ims-table ims-table--compact">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Supplier 1</th>
                  <th>Supplier 2</th>
                  <th>Short code</th>
                  <th>Price / unit</th>
                  <th>Qty</th>
                  <th>Total cost</th>
                </tr>
              </thead>
              <tbody>
                {importPreview.map((row, index) => (
                  <tr key={`${row.shortCode || row.name}-${index}`}>
                    <td>{row.name}</td>
                    <td>{row.type || "–"}</td>
                    <td>{row.supplier1 || "–"}</td>
                    <td>{row.supplier2 || "–"}</td>
                    <td>{row.shortCode || "–"}</td>
                    <td>£{row.pricePerUnit.toFixed(2)}</td>
                    <td>{row.quantity || 0}</td>
                    <td>£{row.totalCost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
