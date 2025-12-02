// src/app/inventory/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  doc,
  getDoc,
  updateDoc,
  Timestamp,
  collection,
  query,
  getDocs,
  orderBy,
} from "firebase/firestore";

type Item = {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  itemType?: string;
  unitOfMeasure?: string;
  standardCost?: number;
  standardCostCurrency?: string;
  reorderLevel?: number | null;
  reorderQuantity?: number | null;
  usefulLifeMonths?: number | null;
  status?: "active" | "discontinued" | string;
  environment?: string | null;
  hubspotProductId?: string | null;
  xeroItemCode?: string | null;
  // Stock quantity fields
  inventoryQty?: number | null;
  wipQty?: number | null;
  completedQty?: number | null;
  // New: multiple must-have product references (by itemId)
  mustHaveItemIds?: string[];
};

type FormState = {
  sku: string;
  name: string;
  description: string;
  itemType: string;
  unitOfMeasure: string;
  standardCost: string;
  standardCostCurrency: string;
  reorderLevel: string;
  reorderQuantity: string;
  usefulLifeMonths: string;
  status: "active" | "discontinued";
  environment: string;
  hubspotProductId: string;
  xeroItemCode: string;
  // Stock quantity fields (as strings for inputs)
  inventoryQty: string;
  wipQty: string;
  completedQty: string;
};

type LinkedItem = {
  id: string;
  sku: string;
  name: string;
};

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [item, setItem] = useState<Item | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // All products, for the must-have dropdown
  const [allItems, setAllItems] = useState<LinkedItem[]>([]);
  // Selected must-have product IDs
  const [selectedMustHaveIds, setSelectedMustHaveIds] = useState<string[]>([]);

  useEffect(() => {
    const loadItem = async () => {
      if (!id) return;
      setLoading(true);
      setError(null);

      try {
        const ref = doc(db, "items", id);
        const itemsRef = collection(db, "items");

        // Load this item + all items for the must-have dropdown
        const [snap, allSnap] = await Promise.all([
          getDoc(ref),
          getDocs(query(itemsRef, orderBy("name"))),
        ]);

        if (!snap.exists()) {
          setError("Product not found.");
          setLoading(false);
          return;
        }

        const all: LinkedItem[] = allSnap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            sku: data.sku ?? "",
            name: data.name ?? "",
          };
        });
        setAllItems(all);

        const data = snap.data() as any;

        // Prefer array field; fall back to legacy string-based "mustHave"
        let mustHaveItemIds: string[] = Array.isArray(data.mustHaveItemIds)
          ? (data.mustHaveItemIds as string[])
          : [];

        if (!mustHaveItemIds.length && data.mustHave) {
          const legacy = String(data.mustHave).trim().toLowerCase();
          if (legacy) {
            mustHaveItemIds = all
              .filter(
                (i) =>
                  i.sku.toLowerCase() === legacy ||
                  i.name.toLowerCase() === legacy,
              )
              .map((i) => i.id);
          }
        }

        const loaded: Item = {
          id: snap.id,
          sku: data.sku ?? "",
          name: data.name ?? "",
          description: data.description ?? "",
          itemType: data.itemType ?? data.rawCsvItemType ?? "",
          unitOfMeasure: data.unitOfMeasure ?? "ea",
          standardCost:
            typeof data.standardCost === "number"
              ? data.standardCost
              : undefined,
          standardCostCurrency: data.standardCostCurrency ?? "GBP",
          reorderLevel:
            typeof data.reorderLevel === "number" ? data.reorderLevel : null,
          reorderQuantity:
            typeof data.reorderQuantity === "number"
              ? data.reorderQuantity
              : null,
          usefulLifeMonths:
            typeof data.usefulLifeMonths === "number"
              ? data.usefulLifeMonths
              : null,
          status: data.status ?? "active",
          environment: data.saltFresh ?? data.environment ?? "",
          hubspotProductId: data.hubspotProductId ?? "",
          xeroItemCode: data.xeroItemCode ?? "",
          inventoryQty:
            typeof data.inventoryQty === "number" ? data.inventoryQty : null,
          wipQty: typeof data.wipQty === "number" ? data.wipQty : null,
          completedQty:
            typeof data.completedQty === "number"
              ? data.completedQty
              : null,
          mustHaveItemIds,
        };

        setItem(loaded);
        setSelectedMustHaveIds(loaded.mustHaveItemIds ?? []);

        setForm({
          sku: loaded.sku,
          name: loaded.name,
          description: loaded.description ?? "",
          itemType: loaded.itemType ?? "component",
          unitOfMeasure: loaded.unitOfMeasure ?? "ea",
          standardCost:
            loaded.standardCost != null ? String(loaded.standardCost) : "",
          standardCostCurrency: loaded.standardCostCurrency ?? "GBP",
          reorderLevel:
            loaded.reorderLevel != null ? String(loaded.reorderLevel) : "",
          reorderQuantity:
            loaded.reorderQuantity != null
              ? String(loaded.reorderQuantity)
              : "",
          usefulLifeMonths:
            loaded.usefulLifeMonths != null
              ? String(loaded.usefulLifeMonths)
              : "",
          status:
            loaded.status === "discontinued" ? "discontinued" : "active",
          environment: loaded.environment ?? "",
          hubspotProductId: loaded.hubspotProductId ?? "",
          xeroItemCode: loaded.xeroItemCode ?? "",
          inventoryQty:
            loaded.inventoryQty != null ? String(loaded.inventoryQty) : "",
          wipQty: loaded.wipQty != null ? String(loaded.wipQty) : "",
          completedQty:
            loaded.completedQty != null ? String(loaded.completedQty) : "",
        });
      } catch (err: any) {
        console.error("Error loading product", err);
        setError(err?.message ?? "Error loading product");
      } finally {
        setLoading(false);
      }
    };

    loadItem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleChange = (field: keyof FormState, value: string) => {
    if (!form) return;
    setForm({ ...form, [field]: value });
  };

  const handleMustHaveMultiChange = (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const options = Array.from(e.target.selectedOptions);
    setSelectedMustHaveIds(options.map((o) => o.value));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !item) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const ref = doc(db, "items", item.id);
      await updateDoc(ref, {
        sku: form.sku.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        itemType: form.itemType,
        unitOfMeasure: form.unitOfMeasure,
        standardCost: form.standardCost ? Number(form.standardCost) : null,
        standardCostCurrency: form.standardCostCurrency,
        reorderLevel: form.reorderLevel ? Number(form.reorderLevel) : null,
        reorderQuantity: form.reorderQuantity
          ? Number(form.reorderQuantity)
          : null,
        usefulLifeMonths: form.usefulLifeMonths
          ? Number(form.usefulLifeMonths)
          : null,
        status: form.status,
        saltFresh: form.environment || null,
        hubspotProductId: form.hubspotProductId || null,
        xeroItemCode: form.xeroItemCode || null,
        inventoryQty: form.inventoryQty ? Number(form.inventoryQty) : 0,
        wipQty: form.wipQty ? Number(form.wipQty) : 0,
        completedQty: form.completedQty ? Number(form.completedQty) : 0,
        mustHaveItemIds: selectedMustHaveIds,
        updatedAt: Timestamp.now(),
      });

      // Update local item state to reflect changes
      setItem((prev) =>
        prev
          ? {
              ...prev,
              sku: form.sku.trim(),
              name: form.name.trim(),
              description: form.description.trim() || null,
              itemType: form.itemType,
              unitOfMeasure: form.unitOfMeasure,
              standardCost: form.standardCost
                ? Number(form.standardCost)
                : undefined,
              standardCostCurrency: form.standardCostCurrency,
              reorderLevel: form.reorderLevel
                ? Number(form.reorderLevel)
                : null,
              reorderQuantity: form.reorderQuantity
                ? Number(form.reorderQuantity)
                : null,
              usefulLifeMonths: form.usefulLifeMonths
                ? Number(form.usefulLifeMonths)
                : null,
              status: form.status,
              environment: form.environment || null,
              hubspotProductId: form.hubspotProductId || null,
              xeroItemCode: form.xeroItemCode || null,
              inventoryQty: form.inventoryQty
                ? Number(form.inventoryQty)
                : 0,
              wipQty: form.wipQty ? Number(form.wipQty) : 0,
              completedQty: form.completedQty
                ? Number(form.completedQty)
                : 0,
              mustHaveItemIds: selectedMustHaveIds,
            }
          : prev,
      );

      setMessage("Product updated.");
      setIsEditing(false);
    } catch (err: any) {
      console.error("Error saving product", err);
      setError(err?.message ?? "Error saving product");
    } finally {
      setSaving(false);
    }
  };

  const renderMustHaveView = () => {
    if (!selectedMustHaveIds.length) return <div>—</div>;

    return (
      <ul className="ims-tag-list">
        {selectedMustHaveIds.map((id) => {
          const linked = allItems.find((i) => i.id === id);
          if (!linked) return null;
          return (
            <li key={id}>
              <Link
                href={`/inventory/${linked.id}`}
                className="ims-table-link"
              >
                {linked.name}{" "}
                <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>
                  ({linked.sku})
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <main className="ims-content">
      {loading ? (
        <p>Loading product…</p>
      ) : error ? (
        <p className="ims-form-error">{error}</p>
      ) : !item || !form ? (
        <p className="ims-form-error">Product not found.</p>
      ) : (
        <>
          <div className="ims-page-header ims-page-header--with-actions">
            <div>
              <h1 className="ims-page-title">
                {item.name}{" "}
                <span style={{ fontWeight: 400, fontSize: "0.9rem" }}>
                  ({item.sku})
                </span>
              </h1>
              <p className="ims-page-subtitle">
                View and edit product details. Changes will be saved to
                Firestore and reflected across IMS.
              </p>
            </div>
            <div className="ims-page-actions">
              <button
                type="button"
                className="ims-secondary-button"
                onClick={() => router.push("/inventory")}
              >
                ← Back
              </button>
              {!isEditing && (
                <button
                  className="ims-primary-button"
                  type="button"
                  onClick={() => setIsEditing(true)}
                >
                  Edit
                </button>
              )}
            </div>
          </div>

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

          <form className="ims-form-grid" onSubmit={handleSave}>
            {/* Left: basic info */}
            <section className="ims-form-section card">
              <h2 className="ims-form-section-title">Basic details</h2>
              <p className="ims-form-section-subtitle">
                Core identifiers used in inventory, projects and assets.
              </p>

              <div className="ims-field">
                <label className="ims-field-label" htmlFor="sku">
                  SKU / Part code
                </label>
                {isEditing ? (
                  <input
                    id="sku"
                    className="ims-field-input"
                    value={form.sku}
                    onChange={(e) => handleChange("sku", e.target.value)}
                  />
                ) : (
                  <div>{item.sku}</div>
                )}
              </div>

              <div className="ims-field">
                <label className="ims-field-label" htmlFor="name">
                  Name
                </label>
                {isEditing ? (
                  <input
                    id="name"
                    className="ims-field-input"
                    value={form.name}
                    onChange={(e) => handleChange("name", e.target.value)}
                  />
                ) : (
                  <div>{item.name}</div>
                )}
              </div>

              <div className="ims-field">
                <label className="ims-field-label" htmlFor="description">
                  Description
                </label>
                {isEditing ? (
                  <textarea
                    id="description"
                    className="ims-field-input ims-field-textarea"
                    rows={3}
                    value={form.description}
                    onChange={(e) =>
                      handleChange("description", e.target.value)
                    }
                  />
                ) : (
                  <div>{item.description || "—"}</div>
                )}
              </div>

              <div className="ims-field-row">
                <div className="ims-field">
                  <label className="ims-field-label" htmlFor="itemType">
                    Item type
                  </label>
                  {isEditing ? (
                    <input
                      id="itemType"
                      className="ims-field-input"
                      value={form.itemType}
                      onChange={(e) =>
                        handleChange("itemType", e.target.value)
                      }
                    />
                  ) : (
                    <div>{item.itemType || "—"}</div>
                  )}
                </div>

                <div className="ims-field">
                  <label
                    className="ims-field-label"
                    htmlFor="unitOfMeasure"
                  >
                    Unit of measure
                  </label>
                  {isEditing ? (
                    <input
                      id="unitOfMeasure"
                      className="ims-field-input"
                      value={form.unitOfMeasure}
                      onChange={(e) =>
                        handleChange("unitOfMeasure", e.target.value)
                      }
                    />
                  ) : (
                    <div>{item.unitOfMeasure || "ea"}</div>
                  )}
                </div>
              </div>
            </section>

            {/* Right: costing & lifecycle */}
            <section className="ims-form-stack">
              <div className="ims-form-section card">
                <h2 className="ims-form-section-title">Costing</h2>
                <p className="ims-form-section-subtitle">
                  Standard cost and environment flags.
                </p>

                <div className="ims-field-row">
                  <div className="ims-field">
                    <label
                      className="ims-field-label"
                      htmlFor="standardCost"
                    >
                      Standard cost
                    </label>
                    {isEditing ? (
                      <input
                        id="standardCost"
                        type="number"
                        min="0"
                        step="0.01"
                        className="ims-field-input"
                        value={form.standardCost}
                        onChange={(e) =>
                          handleChange("standardCost", e.target.value)
                        }
                      />
                    ) : (
                      <div>
                        {item.standardCost != null
                          ? `£${item.standardCost.toFixed(2)}`
                          : "—"}
                      </div>
                    )}
                  </div>
                  <div className="ims-field">
                    <label
                      className="ims-field-label"
                      htmlFor="standardCostCurrency"
                    >
                      Currency
                    </label>
                    {isEditing ? (
                      <select
                        id="standardCostCurrency"
                        className="ims-field-input"
                        value={form.standardCostCurrency}
                        onChange={(e) =>
                          handleChange(
                            "standardCostCurrency",
                            e.target.value,
                          )
                        }
                      >
                        <option value="GBP">GBP</option>
                        <option value="EUR">EUR</option>
                        <option value="USD">USD</option>
                      </select>
                    ) : (
                      <div>{item.standardCostCurrency || "GBP"}</div>
                    )}
                  </div>
                </div>

                <div className="ims-field-row">
                  <div className="ims-field">
                    <label
                      className="ims-field-label"
                      htmlFor="environment"
                    >
                      Environment (Salt/Fresh)
                    </label>
                    {isEditing ? (
                      <input
                        id="environment"
                        className="ims-field-input"
                        value={form.environment}
                        onChange={(e) =>
                          handleChange("environment", e.target.value)
                        }
                      />
                    ) : (
                      <div>{item.environment || "—"}</div>
                    )}
                  </div>

                  <div className="ims-field">
                    <label
                      className="ims-field-label"
                      htmlFor="mustHaveMulti"
                    >
                      Must have products
                    </label>
                    {isEditing ? (
                      <>
                        <select
                          id="mustHaveMulti"
                          className="ims-field-input"
                          multiple
                          value={selectedMustHaveIds}
                          onChange={handleMustHaveMultiChange}
                          size={Math.min(
                            8,
                            Math.max(
                              4,
                              selectedMustHaveIds.length || 4,
                            ),
                          )}
                        >
                          {allItems.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.name} ({opt.sku})
                            </option>
                          ))}
                        </select>
                        <p className="ims-field-help">
                          Choose one or more products that must always be
                          included with this item. Use Ctrl/Cmd + click to
                          select multiple.
                        </p>
                      </>
                    ) : (
                      renderMustHaveView()
                    )}
                  </div>
                </div>
              </div>

              <div className="ims-form-section card">
                <h2 className="ims-form-section-title">
                  Replenishment & lifecycle
                </h2>
                <p className="ims-form-section-subtitle">
                  Reorder thresholds, useful life, stock levels and integration
                  IDs.
                </p>

                {/* Stock quantities */}
                <div className="ims-field-row">
                  <div className="ims-field">
                    <label
                      className="ims-field-label"
                      htmlFor="inventoryQty"
                    >
                      Inventory stock
                    </label>
                    {isEditing ? (
                      <input
                        id="inventoryQty"
                        type="number"
                        min="0"
                        className="ims-field-input"
                        value={form.inventoryQty}
                        onChange={(e) =>
                          handleChange("inventoryQty", e.target.value)
                        }
                      />
                    ) : (
                      <div>{item.inventoryQty ?? 0}</div>
                    )}
                  </div>

                  <div className="ims-field">
                    <label className="ims-field-label" htmlFor="wipQty">
                      WIP stock
                    </label>
                    {isEditing ? (
                      <input
                        id="wipQty"
                        type="number"
                        min="0"
                        className="ims-field-input"
                        value={form.wipQty}
                        onChange={(e) =>
                          handleChange("wipQty", e.target.value)
                        }
                      />
                    ) : (
                      <div>{item.wipQty ?? 0}</div>
                    )}
                  </div>
                </div>

                <div className="ims-field">
                  <label
                    className="ims-field-label"
                    htmlFor="completedQty"
                  >
                    Completed stock
                  </label>
                  {isEditing ? (
                    <input
                      id="completedQty"
                      type="number"
                      min="0"
                      className="ims-field-input"
                      value={form.completedQty}
                      onChange={(e) =>
                        handleChange("completedQty", e.target.value)
                      }
                    />
                  ) : (
                    <div>{item.completedQty ?? 0}</div>
                  )}
                </div>

                <hr className="ims-form-divider" />

                <div className="ims-field-row">
                  <div className="ims-field">
                    <label
                      className="ims-field-label"
                      htmlFor="reorderLevel"
                    >
                      Reorder level
                    </label>
                    {isEditing ? (
                      <input
                        id="reorderLevel"
                        type="number"
                        min="0"
                        className="ims-field-input"
                        value={form.reorderLevel}
                        onChange={(e) =>
                          handleChange("reorderLevel", e.target.value)
                        }
                      />
                    ) : (
                      <div>
                        {item.reorderLevel != null
                          ? item.reorderLevel
                          : "—"}
                      </div>
                    )}
                  </div>

                  <div className="ims-field">
                    <label
                      className="ims-field-label"
                      htmlFor="reorderQuantity"
                    >
                      Typical reorder quantity
                    </label>
                    {isEditing ? (
                      <input
                        id="reorderQuantity"
                        type="number"
                        min="0"
                        className="ims-field-input"
                        value={form.reorderQuantity}
                        onChange={(e) =>
                          handleChange(
                            "reorderQuantity",
                            e.target.value,
                          )
                        }
                      />
                    ) : (
                      <div>
                        {item.reorderQuantity != null
                          ? item.reorderQuantity
                          : "—"}
                      </div>
                    )}
                  </div>
                </div>

                <div className="ims-field-row">
                  <div className="ims-field">
                    <label
                      className="ims-field-label"
                      htmlFor="usefulLifeMonths"
                    >
                      Useful life (months)
                    </label>
                    {isEditing ? (
                      <input
                        id="usefulLifeMonths"
                        type="number"
                        min="0"
                        className="ims-field-input"
                        value={form.usefulLifeMonths}
                        onChange={(e) =>
                          handleChange(
                            "usefulLifeMonths",
                            e.target.value,
                          )
                        }
                      />
                    ) : (
                      <div>
                        {item.usefulLifeMonths != null
                          ? item.usefulLifeMonths
                          : "—"}
                      </div>
                    )}
                  </div>

                  <div className="ims-field">
                    <label className="ims-field-label" htmlFor="status">
                      Status
                    </label>
                    {isEditing ? (
                      <select
                        id="status"
                        className="ims-field-input"
                        value={form.status}
                        onChange={(e) =>
                          handleChange(
                            "status",
                            e.target.value as "active" | "discontinued",
                          )
                        }
                      >
                        <option value="active">Active</option>
                        <option value="discontinued">Discontinued</option>
                      </select>
                    ) : (
                      <span
                        className={
                          "ims-status-tag " +
                          (item.status === "discontinued"
                            ? "ims-status-tag--inactive"
                            : "ims-status-tag--active")
                        }
                      >
                        {item.status ?? "active"}
                      </span>
                    )}
                  </div>
                </div>

                <div className="ims-field">
                  <label
                    className="ims-field-label"
                    htmlFor="hubspotProductId"
                  >
                    HubSpot product ID
                  </label>
                  {isEditing ? (
                    <input
                      id="hubspotProductId"
                      className="ims-field-input"
                      value={form.hubspotProductId}
                      onChange={(e) =>
                        handleChange("hubspotProductId", e.target.value)
                      }
                    />
                  ) : (
                    <div>{item.hubspotProductId || "—"}</div>
                  )}
                </div>

                <div className="ims-field">
                  <label
                    className="ims-field-label"
                    htmlFor="xeroItemCode"
                  >
                    Xero item code
                  </label>
                  {isEditing ? (
                    <input
                      id="xeroItemCode"
                      className="ims-field-input"
                      value={form.xeroItemCode}
                      onChange={(e) =>
                        handleChange("xeroItemCode", e.target.value)
                      }
                    />
                  ) : (
                    <div>{item.xeroItemCode || "—"}</div>
                  )}
                </div>

                {isEditing && (
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
                        setIsEditing(false);
                        setMessage(null);
                        setError(null);
                        router.refresh();
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="ims-primary-button"
                      disabled={saving}
                    >
                      {saving ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                )}
              </div>
            </section>
          </form>
        </>
      )}
    </main>
  );
}
