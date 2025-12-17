"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { useAuth } from "@/app/_components/AuthProvider";
import { normalizeItemType } from "@/lib/inventoryPaths";

type ItemType =
  | "product"
  | "sub assembly"
  | "component"
  | "sensor"
  | "sensor extra";

type FormState = {
  name: string;
  shortCode: string;
  description: string;
  itemType: ItemType;
  category: string;
  supplier1: string;
  supplier2: string;
  supplier1Id: string;
  supplier2Id: string;
  quantity: string;
  standardCost: string;
  usefulLifeMonths: string;
};

const initialFormState: FormState = {
  name: "",
  shortCode: "",
  description: "",
  itemType: "component",
  category: "",
  supplier1: "",
  supplier2: "",
  supplier1Id: "",
  supplier2Id: "",
  quantity: "",
  standardCost: "",
  usefulLifeMonths: "",
};

type SupplierOption = {
  id: string;
  name: string;
};

type SensorExtraOption = {
  id: string;
  name: string;
  sku?: string | null;
};

type SelectedSensorExtra = {
  id: string;
  name: string;
  sku?: string | null;
};

export default function NewProductPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form, setForm] = useState<FormState>(initialFormState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presetAppliedRef = useRef(false);
  const { canEdit } = useAuth();
  const isReadOnly = !canEdit;
  const [supplierOptions, setSupplierOptions] = useState<SupplierOption[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [sensorExtraOptions, setSensorExtraOptions] = useState<SensorExtraOption[]>([]);
  const [loadingSensorExtras, setLoadingSensorExtras] = useState(true);
  const [sensorExtraError, setSensorExtraError] = useState<string | null>(null);
  const [selectedSensorExtras, setSelectedSensorExtras] = useState<SelectedSensorExtra[]>([]);

  const creationPresets = {
    products: {
      label: "Product",
      itemType: "product" as ItemType,
      category: "Unit",
    },
    subAssemblies: {
      label: "Sub-assembly",
      itemType: "sub assembly" as ItemType,
      category: "Unit",
    },
    components: {
      label: "Component",
      itemType: "component" as ItemType,
      category: "",
    },
    sensors: {
      label: "Sensor",
      itemType: "sensor" as ItemType,
      category: "Sensor",
    },
    sensorExtras: {
      label: "Sensor extra",
      itemType: "sensor extra" as ItemType,
      category: "Sensor Extra",
    },
  } as const;

  type CreationPresetKey = keyof typeof creationPresets;

  const presetKey = searchParams.get("type") as CreationPresetKey | null;
  const activePreset = useMemo(
    () => (presetKey ? creationPresets[presetKey] : null),
    [presetKey],
  );

  useEffect(() => {
    if (!activePreset || presetAppliedRef.current) return;
    setForm((prev) => ({
      ...prev,
      itemType: activePreset.itemType,
      category: activePreset.category ?? prev.category,
    }));
    presetAppliedRef.current = true;
  }, [activePreset]);

  useEffect(() => {
    const loadSuppliers = async () => {
      setLoadingSuppliers(true);
      setSupplierError(null);
      try {
        const snap = await getDocs(
          query(collection(db, "suppliers"), orderBy("name")),
        );
        const rows: SupplierOption[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as any;
          return { id: docSnap.id, name: data.name ?? "Unnamed supplier" };
        });
        setSupplierOptions(rows);
      } catch (err: any) {
        console.error("Error loading suppliers", err);
        setSupplierError(err?.message ?? "Unable to load suppliers.");
      } finally {
        setLoadingSuppliers(false);
      }
    };

    loadSuppliers();
  }, []);

  useEffect(() => {
    const loadSensorExtras = async () => {
      setLoadingSensorExtras(true);
      setSensorExtraError(null);
      try {
        const snap = await getDocs(
          query(collection(db, "items"), orderBy("name")),
        );
        const rows: SensorExtraOption[] = snap.docs
          .map((docSnap) => {
            const data = docSnap.data() as any;
            const type = normalizeItemType(
              data.itemType ?? data.rawCsvItemType ?? data.category ?? "",
            );
            if (
              type !== "sensor extra" &&
              type !== "sensor extras" &&
              type !== "sensorextra"
            ) {
              return null;
            }
            return {
              id: docSnap.id,
              name: data.name ?? data.sku ?? "Sensor extra",
              sku: data.sku ?? data.shortCode ?? null,
            };
          })
          .filter(
            (option): option is SensorExtraOption => option !== null,
          );
        setSensorExtraOptions(rows);
      } catch (err: any) {
        console.error("Error loading sensor extras", err);
        setSensorExtraError(err?.message ?? "Unable to load sensor extras.");
      } finally {
        setLoadingSensorExtras(false);
      }
    };

    loadSensorExtras();
  }, []);

  const creationLabel = activePreset?.label ?? "Item";

  const availableSensorExtras = useMemo(
    () =>
      sensorExtraOptions.filter(
        (option) =>
          !selectedSensorExtras.some((selected) => selected.id === option.id),
      ),
    [sensorExtraOptions, selectedSensorExtras],
  );

  const isSensor = form.itemType === "sensor";

  const handleChange = (
    field: keyof FormState,
    value: string | boolean | string[],
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddSensorExtra = (extraId: string) => {
    if (!extraId) return;
    const option = sensorExtraOptions.find((opt) => opt.id === extraId);
    if (!option) return;
    setSelectedSensorExtras((prev) => [
      ...prev,
      { id: option.id, name: option.name, sku: option.sku },
    ]);
  };

  const handleRemoveSensorExtra = (extraId: string) => {
    setSelectedSensorExtras((prev) => prev.filter((extra) => extra.id !== extraId));
  };

  const validate = (): string | null => {
    if (!form.name.trim()) return "Name is required.";
    if (!form.shortCode.trim()) return "Short code is required.";
    if (!form.standardCost.trim()) return "Cost price is required.";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isReadOnly) {
      setError("You do not have permission to add inventory items.");
      return;
    }

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const now = Timestamp.now();
      const quantityNumber = Number(form.quantity);
      const costNumber = Number(form.standardCost);

      const supplier1Option = supplierOptions.find(
        (supplier) => supplier.id === form.supplier1Id,
      );
      const supplier2Option = supplierOptions.find(
        (supplier) => supplier.id === form.supplier2Id,
      );
      const mandatorySensorExtras =
        form.itemType === "sensor"
          ? selectedSensorExtras.map((extra) => ({
              sensorExtraId: extra.id,
              name: extra.name,
              sku: extra.sku ?? null,
              mandatory: true,
            }))
          : [];

      await addDoc(collection(db, "items"), {
        name: form.name.trim(),
        shortName: form.name.trim(),
        description: form.description.trim() || null,
        itemType: form.itemType,
        category: form.category || null,
        shortCode: form.shortCode.trim(),
        supplier1: supplier1Option?.name ?? "",
        supplier1Id: supplier1Option?.id ?? null,
        supplier2: supplier2Option?.name ?? "",
        supplier2Id: supplier2Option?.id ?? null,
        inventoryQty:
          Number.isFinite(quantityNumber) && quantityNumber
            ? quantityNumber
            : 0,
        standardCost: Number.isFinite(costNumber) ? costNumber : 0,
        standardCostCurrency: "GBP",
        usefulLifeMonths: form.usefulLifeMonths
          ? Number(form.usefulLifeMonths)
          : null,
        ...(form.itemType === "sensor"
          ? { mandatorySensorExtras }
          : {}),
        status: "active",
        createdByUserId: "system",
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
          <h1 className="ims-page-title">Add {creationLabel}</h1>
          <p className="ims-page-subtitle">
            Create a new {creationLabel.toLowerCase()} in the WATR inventory master,
            including categories, costing and integration hooks.
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
            disabled={saving || isReadOnly}
          >
            {saving ? "Saving…" : "Save Product"}
          </button>
        </div>
      </div>

      {isReadOnly && (
        <div className="ims-alert ims-alert--info">
          You are in view-only mode. Browse existing items, but you will need an
          elevated account to add or edit inventory.
        </div>
      )}

      <form
        id="new-product-form"
        className="ims-form-section card"
        onSubmit={handleSubmit}
      >
        <fieldset
          disabled={isReadOnly}
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          <h2 className="ims-form-section-title">Component basics</h2>
          <p className="ims-form-section-subtitle">
            Capture the minimum data we need to start tracking this component in
            inventory.
          </p>

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
          <label className="ims-field-label" htmlFor="shortCode">
            Short code<span className="ims-required">*</span>
          </label>
          <input
            id="shortCode"
            type="text"
            className="ims-field-input"
            value={form.shortCode}
            onChange={(e) => handleChange("shortCode", e.target.value)}
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
              Type
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
              <option value="product">Product</option>
              <option value="sub assembly">Sub-assembly</option>
              <option value="sensor">Sensor</option>
              <option value="sensor extra">Sensor extra</option>
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
        </div>

          <div className="ims-field-row">
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="supplier1">
                Supplier 1
              </label>
              <select
                id="supplier1"
                className="ims-field-input"
                value={form.supplier1Id}
                onChange={(e) => handleChange("supplier1Id", e.target.value)}
                disabled={isReadOnly || loadingSuppliers}
              >
                <option value="">Select supplier…</option>
                {supplierOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="supplier2">
                Supplier 2
              </label>
              <select
                id="supplier2"
                className="ims-field-input"
                value={form.supplier2Id}
                onChange={(e) => handleChange("supplier2Id", e.target.value)}
                disabled={isReadOnly || loadingSuppliers}
              >
                <option value="">Select supplier…</option>
                {supplierOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {supplierError && (
            <p className="ims-field-help" style={{ color: "#b91c1c" }}>
              {supplierError}
            </p>
          )}
          {!loadingSuppliers && !supplierOptions.length && (
            <p className="ims-field-help">
              No suppliers found. Add one from the Suppliers page to link it here.
            </p>
          )}

          {isSensor && (
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="mandatorySensorExtras">
                Mandatory sensor extras
              </label>
              <p className="ims-field-help">
                Choose the extras that must accompany this sensor when it is deployed.
              </p>
              <select
                id="mandatorySensorExtras"
                className="ims-field-input"
                defaultValue=""
                onChange={(e) => {
                  handleAddSensorExtra(e.target.value);
                  e.target.value = "";
                }}
                disabled={availableSensorExtras.length === 0 || isReadOnly || loadingSensorExtras}
              >
                <option value="">
                  {loadingSensorExtras
                    ? "Loading sensor extras…"
                    : "Select sensor extra…"}
                </option>
                {availableSensorExtras.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                    {option.sku ? ` (${option.sku})` : ""}
                  </option>
                ))}
              </select>
              {sensorExtraError && (
                <p className="ims-field-help" style={{ color: "#b91c1c" }}>
                  {sensorExtraError}
                </p>
              )}
              {!loadingSensorExtras && !sensorExtraOptions.length && (
                <p className="ims-field-help">
                  No sensor extras available yet. Add them to inventory to link them here.
                </p>
              )}
              {selectedSensorExtras.length === 0 ? (
                <p className="ims-field-help" style={{ marginTop: "0.5rem" }}>
                  No mandatory extras selected.
                </p>
              ) : (
                <ul className="ims-list" style={{ marginTop: "0.5rem" }}>
                  {selectedSensorExtras.map((extra) => (
                    <li key={extra.id}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "0.5rem",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600 }}>{extra.name}</div>
                          {extra.sku && (
                            <div
                              style={{
                                fontSize: "0.8rem",
                                color: "#6b7280",
                              }}
                            >
                              {extra.sku}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="ims-table-link"
                          onClick={() => handleRemoveSensorExtra(extra.id)}
                          disabled={isReadOnly}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

        <div className="ims-field-row">
          <div className="ims-field">
            <label className="ims-field-label" htmlFor="quantity">
              Quantity in stock
            </label>
            <input
              id="quantity"
              type="number"
              step="1"
              className="ims-field-input"
              value={form.quantity}
              onChange={(e) => handleChange("quantity", e.target.value)}
            />
          </div>
          <div className="ims-field">
            <label className="ims-field-label" htmlFor="standardCost">
              Cost price (GBP)<span className="ims-required">*</span>
            </label>
            <input
              id="standardCost"
              type="number"
              min="0"
              step="0.01"
              className="ims-field-input"
              value={form.standardCost}
              onChange={(e) => handleChange("standardCost", e.target.value)}
            />
          </div>
        </div>

          <div className="ims-field">
            <label className="ims-field-label" htmlFor="usefulLifeMonths">
              Useful life (months)
            </label>
            <input
              id="usefulLifeMonths"
              type="number"
              min="0"
              className="ims-field-input"
              value={form.usefulLifeMonths}
              onChange={(e) => handleChange("usefulLifeMonths", e.target.value)}
            />
          </div>
        </fieldset>
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
