"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  getDocs,
  Timestamp,
  query,
  orderBy,
} from "firebase/firestore";

type ItemType = "component" | "sub-assembly" | "finished-good" | "service";

type Category = {
  id: string;
  name: string;
  parentId?: string | null;
};

type FormState = {
  sku: string;
  name: string;
  description: string;
  itemType: ItemType;
  category: string;
  trackSerialNumber: boolean;
  unitOfMeasure: string;

  primaryCategoryId: string;
  subCategoryIds: string[];

  standardCost: string;
  standardCostCurrency: string;

  reorderLevel: string;
  reorderQuantity: string;

  usefulLifeMonths: string;

  status: "active" | "discontinued";

  hubspotProductId: string;
  xeroItemCode: string;
};

const initialFormState: FormState = {
  sku: "",
  name: "",
  description: "",
  itemType: "component",
  category: "",
  trackSerialNumber: false,
  unitOfMeasure: "ea",
  primaryCategoryId: "",
  subCategoryIds: [],
  standardCost: "",
  standardCostCurrency: "GBP",
  reorderLevel: "",
  reorderQuantity: "",
  usefulLifeMonths: "",
  status: "active",
  hubspotProductId: "",
  xeroItemCode: "",
};

export default function NewProductPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialFormState);
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load categories from Firestore (categories collection)
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const ref = collection(db, "categories");
        const q = query(ref, orderBy("name"));
        const snapshot = await getDocs(q);
        const cats: Category[] = snapshot.docs.map((doc) => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            name: data.name ?? "Unnamed",
            parentId: data.parentId ?? null,
          };
        });
        setCategories(cats);
      } catch (err) {
        console.error("Error loading categories", err);
      }
    };

    loadCategories();
  }, []);

  const topLevelCategories = categories.filter((c) => !c.parentId);
  const subcategories = categories.filter((c) => c.parentId);

  const handleChange = (
    field: keyof FormState,
    value: string | boolean | string[],
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubcategoryToggle = (id: string) => {
    setForm((prev) => {
      const exists = prev.subCategoryIds.includes(id);
      return {
        ...prev,
        subCategoryIds: exists
          ? prev.subCategoryIds.filter((x) => x !== id)
          : [...prev.subCategoryIds, id],
      };
    });
  };

  const validate = (): string | null => {
    if (!form.sku.trim()) return "SKU is required.";
    if (!form.name.trim()) return "Name is required.";
    if (!form.primaryCategoryId) return "Primary category is required.";
    if (!form.standardCost) return "Standard cost is required.";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const now = Timestamp.now();

      await addDoc(collection(db, "items"), {
        sku: form.sku.trim(),
        name: form.name.trim(),
        shortName: form.name.trim(),
        description: form.description.trim() || null,

        primaryCategoryId: form.primaryCategoryId,
        subCategoryIds: form.subCategoryIds,

        itemType: form.itemType,
        category: form.category || null,
        trackSerialNumber: form.trackSerialNumber,
        unitOfMeasure: form.unitOfMeasure,

        status: form.status,
        dateIntroduced: now,
        dateDiscontinued: form.status === "discontinued" ? now : null,

        standardCost: Number(form.standardCost),
        standardCostCurrency: form.standardCostCurrency,
        reorderLevel: form.reorderLevel ? Number(form.reorderLevel) : null,
        reorderQuantity: form.reorderQuantity
          ? Number(form.reorderQuantity)
          : null,

        usefulLifeMonths: form.usefulLifeMonths
          ? Number(form.usefulLifeMonths)
          : null,

        hubspotProductId: form.hubspotProductId || null,
        xeroItemCode: form.xeroItemCode || null,

        createdByUserId: "system", // TODO: replace with auth user id
        createdAt: now,
        updatedAt: now,
      });

      // Simple redirect back to a list page (you can change this later)
      router.push("/inventory");
    } catch (err: any) {
      console.error("Error saving product", err);
      setError(err?.message ?? "Error saving product");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Add Product</h1>
          <p className="ims-page-subtitle">
            Create a new item in the WATR inventory master, including
            categories, costing and integration hooks.
          </p>
        </div>
        <div className="ims-page-actions">
          <button
            type="button"
            className="ims-secondary-button"
            onClick={() => router.back()}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="new-product-form"
            className="ims-primary-button"
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Product"}
          </button>
        </div>
      </div>

      <form
        id="new-product-form"
        className="ims-form-grid"
        onSubmit={handleSubmit}
      >
        {/* Left column: basics + categories */}
        <section className="ims-form-section card">
          <h2 className="ims-form-section-title">Basic details</h2>
          <p className="ims-form-section-subtitle">
            Define how this item will appear in the inventory, projects and
            assets.
          </p>

          <div className="ims-field">
            <label className="ims-field-label" htmlFor="sku">
              SKU / Part code<span className="ims-required">*</span>
            </label>
            <input
              id="sku"
              type="text"
              className="ims-field-input"
              value={form.sku}
              onChange={(e) => handleChange("sku", e.target.value)}
            />
          </div>

          <div className="ims-field">
            <label className="ims-field-label" htmlFor="name">
              Name<span className="ims-required">*</span>
            </label>
            <input
              id="name"
              type="text"
              className="ims-field-input"
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
            />
          </div>

          <div className="ims-field">
            <label className="ims-field-label" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              className="ims-field-input ims-field-textarea"
              rows={3}
              value={form.description}
              onChange={(e) => handleChange("description", e.target.value)}
            />
          </div>

          <div className="ims-field-row">
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="itemType">
                Item type
              </label>
              <select
                id="itemType"
                className="ims-field-input"
                value={form.itemType}
                onChange={(e) =>
                  handleChange("itemType", e.target.value as ItemType)
                }
              >
                <option value="component">Component</option>
                <option value="sub-assembly">Sub-assembly</option>
                <option value="finished-good">Finished good</option>
                <option value="service">Service</option>
              </select>
            </div>
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="category">
                Category
              </label>
              <select
                id="category"
                className="ims-field-input"
                value={form.category}
                onChange={(e) => handleChange("category", e.target.value)}
              >
                <option value="">Select category…</option>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="unitOfMeasure">
                Unit of measure
              </label>
              <input
                id="unitOfMeasure"
                type="text"
                className="ims-field-input"
                value={form.unitOfMeasure}
                onChange={(e) =>
                  handleChange("unitOfMeasure", e.target.value)
                }
              />
            </div>
          </div>

          <div className="ims-field ims-field--inline">
            <label className="ims-field-label">Serial tracking</label>
            <label className="ims-toggle">
              <input
                type="checkbox"
                checked={form.trackSerialNumber}
                onChange={(e) =>
                  handleChange("trackSerialNumber", e.target.checked)
                }
              />
              <span className="ims-toggle-slider" />
              <span className="ims-toggle-label">
                Track individual serial numbers
              </span>
            </label>
          </div>

          <hr className="ims-form-divider" />

          <h2 className="ims-form-section-title">Categories</h2>
          <p className="ims-form-section-subtitle">
            Use categories to drive reporting and future configurator logic.
            A primary category is required; sub-categories are optional.
          </p>

          <div className="ims-field">
            <label className="ims-field-label" htmlFor="primaryCategoryId">
              Primary category<span className="ims-required">*</span>
            </label>
            <select
              id="primaryCategoryId"
              className="ims-field-input"
              value={form.primaryCategoryId}
              onChange={(e) =>
                handleChange("primaryCategoryId", e.target.value)
              }
            >
              <option value="">Select a category…</option>
              {topLevelCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {subcategories.length > 0 && (
            <div className="ims-field">
              <label className="ims-field-label">
                Sub-categories (optional)
              </label>
              <div className="ims-chip-list">
                {subcategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={
                      "ims-chip" +
                      (form.subCategoryIds.includes(cat.id)
                        ? " ims-chip--selected"
                        : "")
                    }
                    onClick={() => handleSubcategoryToggle(cat.id)}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
              <p className="ims-field-help">
                Use sub-categories for finer grouping (e.g. “Sensors &gt; Water
                Quality”).
              </p>
            </div>
          )}
        </section>

        {/* Right column: costing, replenishment, lifecycle, integrations */}
        <section className="ims-form-stack">
          <div className="ims-form-section card">
            <h2 className="ims-form-section-title">Costing</h2>
            <p className="ims-form-section-subtitle">
              Set standard cost for configurator, project costing and COGs.
            </p>

            <div className="ims-field-row">
              <div className="ims-field">
                <label className="ims-field-label" htmlFor="standardCost">
                  Standard cost<span className="ims-required">*</span>
                </label>
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
              </div>
              <div className="ims-field">
                <label
                  className="ims-field-label"
                  htmlFor="standardCostCurrency"
                >
                  Currency
                </label>
                <select
                  id="standardCostCurrency"
                  className="ims-field-input"
                  value={form.standardCostCurrency}
                  onChange={(e) =>
                    handleChange("standardCostCurrency", e.target.value)
                  }
                >
                  <option value="GBP">GBP</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>
          </div>

          <div className="ims-form-section card">
            <h2 className="ims-form-section-title">Replenishment</h2>
            <p className="ims-form-section-subtitle">
              Configure thresholds for low-stock alerts and typical order size.
            </p>

            <div className="ims-field-row">
              <div className="ims-field">
                <label className="ims-field-label" htmlFor="reorderLevel">
                  Reorder level
                </label>
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
                <p className="ims-field-help">
                  When on-hand stock falls below this quantity the item will be
                  marked as low stock.
                </p>
              </div>
              <div className="ims-field">
                <label className="ims-field-label" htmlFor="reorderQuantity">
                  Typical reorder quantity
                </label>
                <input
                  id="reorderQuantity"
                  type="number"
                  min="0"
                  className="ims-field-input"
                  value={form.reorderQuantity}
                  onChange={(e) =>
                    handleChange("reorderQuantity", e.target.value)
                  }
                />
              </div>
            </div>
          </div>

          <div className="ims-form-section card">
            <h2 className="ims-form-section-title">Lifecycle & integrations</h2>
            <p className="ims-form-section-subtitle">
              Control availability and link this item to external systems.
            </p>

            <div className="ims-field-row">
              <div className="ims-field">
                <label className="ims-field-label" htmlFor="status">
                  Status
                </label>
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
              </div>
              <div className="ims-field">
                <label
                  className="ims-field-label"
                  htmlFor="usefulLifeMonths"
                >
                  Useful life (months)
                </label>
                <input
                  id="usefulLifeMonths"
                  type="number"
                  min="0"
                  className="ims-field-input"
                  value={form.usefulLifeMonths}
                  onChange={(e) =>
                    handleChange("usefulLifeMonths", e.target.value)
                  }
                />
                <p className="ims-field-help">
                  Used later for DAAS depreciation schedules.
                </p>
              </div>
            </div>

            <div className="ims-field">
              <label className="ims-field-label" htmlFor="hubspotProductId">
                HubSpot product ID
              </label>
              <input
                id="hubspotProductId"
                type="text"
                className="ims-field-input"
                value={form.hubspotProductId}
                onChange={(e) =>
                  handleChange("hubspotProductId", e.target.value)
                }
              />
            </div>

            <div className="ims-field">
              <label className="ims-field-label" htmlFor="xeroItemCode">
                Xero item code
              </label>
              <input
                id="xeroItemCode"
                type="text"
                className="ims-field-input"
                value={form.xeroItemCode}
                onChange={(e) =>
                  handleChange("xeroItemCode", e.target.value)
                }
              />
            </div>
          </div>
        </section>
      </form>

      {error && <p className="ims-form-error">{error}</p>}
    </div>
  );
}
const CATEGORY_OPTIONS = [
  "Unit Extra",
  "Data",
  "Sensor",
  "Support Services",
  "Sensor Extra",
  "Unit",
];
