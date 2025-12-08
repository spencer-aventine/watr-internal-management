// src/app/inventory/InventoryCategoryView.tsx
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
} from "firebase/firestore";

type FirestoreItem = {
  id: string;
  sku: string;
  name: string;
  itemType?: string;
  standardCost?: number;
  salesPrice?: number;
  status?: string;
  environment?: string; // Salt / Fresh from CSV
};

type CsvRow = {
  [key: string]: any;
};

type ImportRow = {
  sku: string;
  name: string;
  mustHave?: string;
  environment?: string;
  standardCost: number;
  salesPrice?: number;
  rawItemType?: string;
};

// Keys used in the table — update this union + allColumns to add/remove columns
type ColumnKey =
  | "sku"
  | "name"
  | "itemType"
  | "standardCost"
  | "salesPrice"
  | "environment"
  | "status";

type ColumnConfig = {
  key: ColumnKey;
  label: string;
};

export type TabKey = "products" | "subAssemblies" | "components";

const tabOptions: { key: TabKey; label: string }[] = [
  { key: "products", label: "Products" },
  { key: "subAssemblies", label: "Sub-assemblies" },
  { key: "components", label: "Components" },
];

const tabRoutes: Record<TabKey, string> = {
  products: "/inventory/products",
  subAssemblies: "/inventory/sub-assemblies",
  components: "/inventory",
};

// Single source of truth for columns
const allColumns: ColumnConfig[] = [
  { key: "sku", label: "SKU" },
  { key: "name", label: "Name" },
  { key: "itemType", label: "Type" },
  { key: "standardCost", label: "Standard cost" },
  { key: "salesPrice", label: "Sales price" },
  { key: "environment", label: "Environment" },
  { key: "status", label: "Status" },
];

const normalizeItemType = (value?: string | null) => {
  if (!value) return "";
  return value.toString().trim().toLowerCase().replace(/[\s_-]+/g, " ");
};

const matchesTab = (item: FirestoreItem, tab: TabKey) => {
  const type = normalizeItemType(item.itemType);
  switch (tab) {
    case "products":
      return type === "product" || type === "products";
    case "subAssemblies":
      return (
        type === "sub assembly" ||
        type === "sub assemblies" ||
        type === "subassembly"
      );
    case "components":
      return type === "component" || type === "components" || type === "";
    default:
      return false;
  }
};

function mapCsvRow(row: CsvRow): ImportRow | null {
  const sku = String(row["*ItemCode"] ?? "").trim();
  const name = String(row["ItemName"] ?? "").trim();
  if (!sku || !name) return null;

  const parseNumber = (value: any): number => {
    if (value == null) return 0;
    const normalized = String(value).replace(/,/g, "");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  };

  return {
    sku,
    name,
    mustHave: row["Must Have"] || "",
    environment: row["Salt / Fresh"] || "",
    standardCost: parseNumber(row["PurchasesUnitPrice"]),
    salesPrice: parseNumber(row["SalesUnitPrice"]),
    rawItemType: row["Item"] || "",
  };
}

type InventoryCategoryViewProps = {
  activeTab: TabKey;
};

export default function InventoryCategoryView({
  activeTab,
}: InventoryCategoryViewProps) {
  const [products, setProducts] = useState<FirestoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importPreview, setImportPreview] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const loadProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      const ref = collection(db, "items");
      const q = query(ref, orderBy("sku"));
      const snapshot = await getDocs(q);
      const rows: FirestoreItem[] = snapshot.docs.map((doc) => {
        const data = doc.data() as any;
        return {
          id: doc.id,
          sku: data.sku ?? "",
          name: data.name ?? "",
          itemType: data.itemType ?? data.rawCsvItemType ?? "",
          standardCost:
            typeof data.standardCost === "number"
              ? data.standardCost
              : undefined,
          salesPrice:
            typeof data.salesPrice === "number" ? data.salesPrice : undefined,
          status: data.status ?? "active",
          environment: data.saltFresh ?? data.environment ?? "",
        };
      });
      setProducts(rows);
    } catch (err: any) {
      console.error("Error loading products", err);
      setError(err?.message ?? "Error loading products");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
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

      for (const row of importPreview) {
        await addDoc(collection(db, "items"), {
          sku: row.sku,
          name: row.name,
          shortName: row.name,
          description: null,

          // Categories: you can update this later to map to real category IDs
          primaryCategoryId: "uncategorised",
          subCategoryIds: [],

          itemType: "component",
          rawCsvItemType: row.rawItemType ?? "",
          trackSerialNumber: false,
          unitOfMeasure: "ea",

          status: "active",
          dateIntroduced: now,
          dateDiscontinued: null,

          standardCost: row.standardCost,
          standardCostCurrency: "GBP",
          reorderLevel: null,
          reorderQuantity: null,

          usefulLifeMonths: null,

          // Extra fields from CSV
          mustHave: row.mustHave || null,
          saltFresh: row.environment || null,
          salesPrice: row.salesPrice ?? null,

          hubspotProductId: null,
          xeroItemCode: null,

          createdByUserId: "system",
          createdAt: now,
          updatedAt: now,
        });
      }

      setMessage(`Imported ${importPreview.length} products into Firestore.`);
      setImportPreview([]);
      await loadProducts();
    } catch (err: any) {
      console.error("Error importing products", err);
      setError(err?.message ?? "Error importing products");
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
    setVisibleColumns(draftColumns.length ? draftColumns : ["sku", "name"]);
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
      products: 0,
      subAssemblies: 0,
      components: 0,
    };
    products.forEach((product) => {
      const match = tabOptions.find((tab) => matchesTab(product, tab.key));
      if (match) {
        counts[match.key] += 1;
      }
    });
    return counts;
  }, [products]);

  const itemsForActiveTab = useMemo(
    () => products.filter((product) => matchesTab(product, activeTab)),
    [products, activeTab],
  );

  const activeTabLabel =
    tabOptions.find((tab) => tab.key === activeTab)?.label ?? "Products";

  // Apply text filter
  const filteredProducts = (() => {
    const text = filterText.trim().toLowerCase();
    if (!text) return itemsForActiveTab;

    return itemsForActiveTab.filter((p) => {
      const values = [
        p.sku,
        p.name,
        p.itemType,
        p.environment,
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
          <h1 className="ims-page-title">Products</h1>
          <p className="ims-page-subtitle">
            Existing items in the WATR inventory master. Use the CSV import
            to seed from your configurator list.
          </p>
        </div>
        <div className="ims-page-actions">
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
                : `Import ${importPreview.length} products`}
            </button>
          )}
      </div>
    </div>

    <div className="ims-tab-bar">
      {tabOptions.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <Link
            key={tab.key}
            href={tabRoutes[tab.key]}
            className={
              "ims-tab-button" + (isActive ? " ims-tab-button--active" : "")
            }
            aria-current={isActive ? "page" : undefined}
          >
            <span>{tab.label}</span>
            <span className="ims-tab-count">{tabCounts[tab.key]}</span>
          </Link>
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

      {/* Existing products table */}
      <section className="card ims-table-card">
        <div className="ims-table-header" style={{ alignItems: "flex-start" }}>
          <div>
            <h2 className="ims-form-section-title">
              {activeTabLabel}
            </h2>
            <span className="ims-table-count">
              {loading
                ? "Loading…"
                : `${filteredProducts.length} of ${itemsForActiveTab.length} ${
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
              placeholder="Filter by SKU, name, type, environment..."
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

        {filteredProducts.length === 0 && !loading ? (
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
                {filteredProducts.map((p) => (
                  <tr key={p.id}>
                    {visibleColumnConfigs.map((col) => {
                      switch (col.key) {
                        case "sku":
                          return (
                            <td key={col.key}>
                              <Link
                                href={`/inventory/${p.id}`}
                                className="ims-table-link"
                              >
                                {p.sku}
                              </Link>
                            </td>
                          );
                        case "name":
                          return (
                            <td key={col.key}>
                              <Link
                                href={`/inventory/${p.id}`}
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
                        case "standardCost":
                          return (
                            <td key={col.key}>
                              {p.standardCost != null
                                ? `£${p.standardCost.toFixed(2)}`
                                : "–"}
                            </td>
                          );
                        case "salesPrice":
                          return (
                            <td key={col.key}>
                              {p.salesPrice != null
                                ? `£${p.salesPrice.toFixed(2)}`
                                : "–"}
                            </td>
                          );
                        case "environment":
                          return (
                            <td key={col.key}>{p.environment || "–"}</td>
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
                  <th>SKU</th>
                  <th>Name</th>
                  <th>Must have</th>
                  <th>Environment</th>
                  <th>Std cost</th>
                  <th>Sales price</th>
                </tr>
              </thead>
              <tbody>
                {importPreview.map((row) => (
                  <tr key={row.sku}>
                    <td>{row.sku}</td>
                    <td>{row.name}</td>
                    <td>{row.mustHave || "–"}</td>
                    <td>{row.environment || "–"}</td>
                    <td>£{row.standardCost.toFixed(2)}</td>
                    <td>
                      {row.salesPrice != null
                        ? `£${row.salesPrice.toFixed(2)}`
                        : "–"}
                    </td>
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
