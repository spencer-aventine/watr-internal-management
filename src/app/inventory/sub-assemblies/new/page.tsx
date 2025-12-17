// src/app/inventory/sub-assemblies/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { normalizeItemType } from "@/lib/inventoryPaths";

type ComponentOption = {
  id: string;
  sku: string;
  name: string;
  unitCost: number;
};

type FormState = {
  name: string;
  sku: string;
  price: string;
  componentQuantities: Record<string, number>;
};

const initialState: FormState = {
  name: "",
  sku: "",
  price: "",
  componentQuantities: {},
};

const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

export default function NewSubAssemblyPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialState);
  const [components, setComponents] = useState<ComponentOption[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [priceTouched, setPriceTouched] = useState(false);

type ItemDoc = {
  sku?: string;
  name?: string;
  standardCost?: number;
  pricePerUnit?: number;
  itemType?: string | null;
  rawCsvItemType?: string | null;
};

type ComponentCandidate = ComponentOption & { normalizedType: string };

  useEffect(() => {
    const loadComponents = async () => {
      setLoading(true);
      setError(null);
      try {
        const ref = collection(db, "items");
        const q = query(ref, orderBy("name"));
        const snap = await getDocs(q);
        const opts: ComponentOption[] = snap.docs
          .map((doc) => {
            const data = doc.data() as ItemDoc;
            const normalizedType = normalizeItemType(
              data.itemType ?? data.rawCsvItemType ?? "",
            );
            return {
              id: doc.id,
              sku: data.sku ?? "",
              name: data.name ?? "",
              unitCost:
                typeof data.pricePerUnit === "number"
                  ? data.pricePerUnit
                  : typeof data.standardCost === "number"
                    ? data.standardCost
                    : 0,
              normalizedType,
            } as ComponentCandidate;
          })
          .filter((item) => {
            return (
              item.normalizedType === "component" ||
              item.normalizedType === "components" ||
              item.normalizedType === ""
            );
          })
          .map(({ normalizedType, ...rest }) => rest);
        setComponents(opts);
      } catch (err: any) {
        console.error("Error loading components", err);
        setError(err?.message ?? "Unable to load components.");
      } finally {
        setLoading(false);
      }
    };

    loadComponents();
  }, []);

  const filteredComponents = useMemo(() => {
    const trimmed = filter.trim().toLowerCase();
    if (!trimmed) return components;
    return components.filter((component) => {
      return (
        component.name.toLowerCase().includes(trimmed) ||
        component.sku.toLowerCase().includes(trimmed)
      );
    });
  }, [filter, components]);

  const setComponentQuantity = (id: string, rawQuantity: number) => {
    const quantity = Number(rawQuantity);
    setForm((prev) => {
      const next = { ...prev.componentQuantities };
      if (!Number.isFinite(quantity) || quantity <= 0) {
        delete next[id];
      } else {
        next[id] = quantity;
      }
      return { ...prev, componentQuantities: next };
    });
  };

  const selectedComponents = useMemo(
    () =>
      Object.entries(form.componentQuantities).filter(
        ([, qty]) => qty > 0 && Number.isFinite(qty),
      ),
    [form.componentQuantities],
  );

  const selectedComponentCount = selectedComponents.length;

  const componentsById = useMemo(() => {
    const map = new Map<string, ComponentOption>();
    components.forEach((component) => map.set(component.id, component));
    return map;
  }, [components]);

  const componentLineTotals = useMemo(() => {
    return selectedComponents.map(([componentId, qty]) => {
      const component = componentsById.get(componentId);
      const unitPrice = component?.unitCost ?? 0;
      const quantity = Number(qty) || 0;
      const total = quantity * unitPrice;
      return {
        componentId,
        quantity,
        unitPrice,
        total,
      };
    });
  }, [selectedComponents, componentsById]);

  const estimatedComponentCost = useMemo(() => {
    return componentLineTotals.reduce((sum, line) => sum + line.total, 0);
  }, [componentLineTotals]);

  const estimatedCostLabel = useMemo(() => {
    const priceNumber = Number(form.price);
    return Number.isFinite(priceNumber) && priceNumber > 0
      ? currencyFormatter.format(priceNumber)
      : "—";
  }, [form.price]);

  useEffect(() => {
    if (priceTouched) return;
    if (!estimatedComponentCost) {
      setForm((prev) => ({ ...prev, price: "" }));
      return;
    }
    setForm((prev) => ({
      ...prev,
      price: estimatedComponentCost.toFixed(2),
    }));
  }, [estimatedComponentCost, priceTouched]);

  const handleChange = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddComponent = (componentId: string) => {
    const currentQty = form.componentQuantities[componentId] ?? 0;
    const nextQty = currentQty + 1;
    setComponentQuantity(componentId, nextQty);
  };

  const handleAdjustSelectedQuantity = (
    componentId: string,
    nextQuantity: number,
  ) => {
    setComponentQuantity(componentId, nextQuantity);
  };

  const handleIncrementSelected = (componentId: string, delta: number) => {
    const currentQty = form.componentQuantities[componentId] ?? 0;
    const nextQty = currentQty + delta;
    setComponentQuantity(componentId, nextQty);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setError("Sub-assembly name is required.");
      return;
    }

    if (!form.price.trim()) {
      setError("Enter a price for this sub-assembly.");
      return;
    }

    const priceNumber = Number(form.price);
    if (!Number.isFinite(priceNumber) || priceNumber < 0) {
      setError("Price must be a valid number.");
      return;
    }

    if (!selectedComponents.length) {
      setError("Select at least one component with a quantity.");
      return;
    }

    setSaving(true);
    try {
      const now = Timestamp.now();
      const componentLines = componentLineTotals.map((line) => ({
        componentId: line.componentId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.total,
      }));
      const componentsTotal = componentLines.reduce(
        (sum, line) => sum + line.lineTotal,
        0,
      );

      const payload = {
        sku: form.sku.trim(),
        name: trimmedName,
        shortName: trimmedName,
        description: null,
        itemType: "sub assembly",
        category: "Unit",
        components: componentLines,
        standardCost: priceNumber,
        standardCostCurrency: "GBP",
        pricePerUnit: priceNumber,
        estimatedComponentCost: componentsTotal,
        totalCost: componentsTotal,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await addDoc(collection(db, "items"), payload);
      setMessage("Sub-assembly created.");
      router.push(`/inventory/sub-assemblies/${docRef.id}`);
    } catch (err: any) {
      console.error("Error creating sub-assembly", err);
      setError(err?.message ?? "Unable to save the sub-assembly.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Add Sub-assembly</h1>
          <p className="ims-page-subtitle">
            Give the assembly a name, price, and choose which components it
            contains.
          </p>
        </div>
        <div className="ims-page-actions">
          <Link href="/inventory" className="ims-secondary-button">
            ← Back to inventory
          </Link>
        </div>
      </div>

      {(error || message) && (
        <div
          className={
            "ims-alert " + (error ? "ims-alert--error" : "ims-alert--info")
          }
        >
          {error || message}
        </div>
      )}

      <form className="ims-form" onSubmit={handleSubmit}>
        <section className="ims-form-section card">
          <h2 className="ims-form-section-title">Sub-assembly details</h2>
          <p className="ims-form-section-subtitle">
            Keep it simple—just a name, SKU (optional) and standard cost.
          </p>

          <div className="ims-field">
            <label className="ims-field-label" htmlFor="name">
              Name<span className="ims-required">*</span>
            </label>
            <input
              id="name"
              className="ims-field-input"
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
              required
            />
          </div>

          <div className="ims-field-row">
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="sku">
                SKU / reference
              </label>
              <input
                id="sku"
                className="ims-field-input"
                value={form.sku}
                onChange={(e) => handleChange("sku", e.target.value)}
              />
            </div>
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="price">
                Standard cost (GBP)<span className="ims-required">*</span>
              </label>
              <input
                id="price"
                type="number"
                min="0"
                step="0.01"
                className="ims-field-input"
                value={form.price}
                onChange={(e) => {
                  setPriceTouched(true);
                  handleChange("price", e.target.value);
                }}
                required
              />
              <p className="ims-field-help">
                Preview: {estimatedCostLabel} (components:{" "}
                {currencyFormatter.format(estimatedComponentCost)})
              </p>
            </div>
          </div>
        </section>

        <section className="ims-form-section card">
          <div className="ims-table-header">
            <div>
              <h2 className="ims-form-section-title">Components</h2>
              <p className="ims-form-section-subtitle">
                Search and select the components that form this sub-assembly.
              </p>
            </div>
            <div>
              <span className="ims-table-count">
                {selectedComponentCount} selected • Estimated cost{" "}
                {currencyFormatter.format(estimatedComponentCost)}
              </span>
            </div>
          </div>

          <div className="ims-field" style={{ marginBottom: "0.75rem" }}>
            <label className="ims-field-label" htmlFor="componentFilter">
              Filter components
            </label>
            <input
              id="componentFilter"
              className="ims-field-input"
              type="text"
              placeholder="Search by name or SKU…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              disabled={loading}
            />
          </div>

          {loading ? (
            <p className="ims-table-empty">Loading components…</p>
          ) : (
            <div className="ims-table-wrapper" style={{ maxHeight: "420px" }}>
              <table className="ims-table ims-table--compact">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>SKU</th>
                    <th>Unit cost</th>
                    <th style={{ width: "140px" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredComponents.map((component) => {
                    const qty = form.componentQuantities[component.id] ?? 0;
                    return (
                      <tr key={component.id}>
                        <td>
                          <strong>{component.name}</strong>
                        </td>
                        <td>{component.sku || "—"}</td>
                        <td>{currencyFormatter.format(component.unitCost)}</td>
                        <td>
                          {qty > 0 ? (
                            <span className="ims-status-tag ims-status-tag--active">
                              Added ({qty})
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="ims-secondary-button"
                              onClick={() => handleAddComponent(component.id)}
                            >
                              + Add
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredComponents.length === 0 && (
                    <tr>
                      <td colSpan={4} className="ims-table-empty">
                        No components match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {selectedComponents.length > 0 && (
          <section className="ims-form-section card">
            <div className="ims-table-header">
              <div>
                <h3 className="ims-form-section-title">
                  Selected components
                </h3>
                <p className="ims-form-section-subtitle">
                  Fine-tune quantities or remove parts from this sub-assembly.
                </p>
              </div>
            </div>
            <div className="ims-table-wrapper">
              <table className="ims-table ims-table--compact">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Unit cost</th>
                    <th style={{ width: "200px" }}>Quantity</th>
                    <th>Line total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {selectedComponents.map(([componentId, qty]) => {
                    const component = componentsById.get(componentId);
                    if (!component) return null;
                    const lineTotal = component.unitCost * qty;
                    return (
                      <tr key={componentId}>
                        <td>
                          <strong>{component.name}</strong>
                        </td>
                        <td>{currencyFormatter.format(component.unitCost)}</td>
                        <td>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.25rem",
                            }}
                          >
                            <button
                              type="button"
                              className="ims-secondary-button"
                              onClick={() =>
                                handleIncrementSelected(componentId, -1)
                              }
                              disabled={qty <= 1}
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={qty}
                              onChange={(e) =>
                                handleAdjustSelectedQuantity(
                                  componentId,
                                  Number(e.target.value),
                                )
                              }
                              style={{ width: "80px" }}
                            />
                            <button
                              type="button"
                              className="ims-secondary-button"
                              onClick={() =>
                                handleIncrementSelected(componentId, 1)
                              }
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td>{currencyFormatter.format(lineTotal)}</td>
                        <td>
                          <button
                            type="button"
                            className="ims-secondary-button"
                            onClick={() =>
                              handleAdjustSelectedQuantity(componentId, 0)
                            }
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className="ims-form-actions">
          <Link href="/inventory" className="ims-secondary-button">
            Cancel
          </Link>
          <button
            type="submit"
            className="ims-primary-button"
            disabled={saving}
          >
            {saving ? "Saving…" : "Create sub-assembly"}
          </button>
        </div>
      </form>
    </main>
  );
}
