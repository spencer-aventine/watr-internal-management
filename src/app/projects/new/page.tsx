// src/app/projects/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  orderBy,
  query,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import {
  ProjectItemCategory,
  PROJECT_ITEM_CATEGORIES,
  PROJECT_ITEM_LABELS,
  ProjectItemLine,
  createEmptyItemsByType,
  normalizeProjectCategory,
  flattenProjectItems,
  serializeProjectLine,
} from "../_projectItemUtils";

type SensorExtraRequirement = {
  sensorExtraId: string;
  name: string;
  quantityPerSensor: number;
};

type ItemOption = {
  id: string;
  name: string;
  sku: string;
  category: ProjectItemCategory;
  mustHaveName?: string | null;
  mandatorySensorExtras?: SensorExtraRequirement[];
};

type NewLineState = {
  id: string;
  itemId: string;
  qty: string;
  mustHaveItemId?: string | null;
  mustHaveLabel?: string;
  mustHaveQty: string;
};

const generateLineId = () =>
  `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const createNewLineState = (): NewLineState => ({
  id: generateLineId(),
  itemId: "",
  qty: "",
  mustHaveItemId: null,
  mustHaveLabel: undefined,
  mustHaveQty: "",
});

const createInitialLineSections = (): Record<
  ProjectItemCategory,
  NewLineState[]
> => ({
  products: [createNewLineState()],
  subAssemblies: [],
  components: [],
  sensors: [],
  sensorExtras: [],
});

const SECONDARY_SECTIONS: ProjectItemCategory[] = [
  "subAssemblies",
  "components",
  "sensors",
];

const SECTION_COPY: Record<
  ProjectItemCategory,
  { title: string; subtitle: string; empty: string; addLabel: string }
> = {
  products: {
    title: "Products in this project",
    subtitle:
      'Choose the finished units being assembled. Mandatory "must have" items will be added automatically.',
    empty: "",
    addLabel: "Add product line",
  },
  subAssemblies: {
    title: "Sub-assemblies",
    subtitle: "Reserve any sub-assemblies being consumed in this build.",
    empty: "No sub-assemblies linked yet.",
    addLabel: "Add sub-assembly",
  },
  components: {
    title: "Loose components",
    subtitle: "Track discrete components that ship outside assemblies.",
    empty: "No components linked yet.",
    addLabel: "Add component",
  },
  sensors: {
    title: "Sensors",
    subtitle: "Include sensors required for this deployment.",
    empty: "No sensors linked yet.",
    addLabel: "Add sensor",
  },
  sensorExtras: {
    title: "",
    subtitle: "",
    empty: "",
    addLabel: "",
  },
};

export default function NewProjectPage() {
  const router = useRouter();
  const [items, setItems] = useState<ItemOption[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newDealId, setNewDealId] = useState("");
  const [newLineSections, setNewLineSections] = useState<
    Record<ProjectItemCategory, NewLineState[]>
  >(() => createInitialLineSections());

  useEffect(() => {
    const loadItems = async () => {
      setLoadingItems(true);
      setError(null);
      try {
        const itemsSnap = await getDocs(
          query(collection(db, "items"), orderBy("name")),
        );
        const options: ItemOption[] = itemsSnap.docs.map((docSnap) => {
          const data = docSnap.data() as any;
          const category = normalizeProjectCategory(
            data.itemType ?? data.rawCsvItemType ?? data.category,
          );
          const mandatorySensorExtras =
            category === "sensors" && Array.isArray(data.mandatorySensorExtras)
              ? data.mandatorySensorExtras
                  .map((extra: any) => {
                    const sensorExtraId =
                      extra?.sensorExtraId ??
                      extra?.itemId ??
                      extra?.id ??
                      extra?.referenceId ??
                      null;
                    if (!sensorExtraId) return null;
                    const ratio = Number(extra?.quantity ?? extra?.qty ?? 1);
                    const quantityPerSensor =
                      Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
                    return {
                      sensorExtraId: String(sensorExtraId),
                      name:
                        extra?.name ??
                        extra?.itemName ??
                        extra?.sku ??
                        "Sensor extra",
                      quantityPerSensor,
                    };
                  })
                  .filter(
                    (entry: SensorExtraRequirement | null): entry is SensorExtraRequirement =>
                      Boolean(entry),
                  )
              : undefined;
          return {
            id: docSnap.id,
            name: data.name ?? "",
            sku: data.sku ?? "",
            category,
            mustHaveName: data.mustHave ?? null,
            mandatorySensorExtras,
          };
        });
        setItems(options);
      } catch (err: any) {
        console.error("Error loading inventory options", err);
        setError(err?.message ?? "Unable to load inventory options.");
      } finally {
        setLoadingItems(false);
      }
    };

    loadItems();
  }, []);

  const itemsByCategory = useMemo(() => {
    const grouped: Record<ProjectItemCategory, ItemOption[]> = {
      products: [],
      subAssemblies: [],
      components: [],
      sensors: [],
      sensorExtras: [],
    };
    items.forEach((item) => {
      grouped[item.category].push(item);
    });
    return grouped;
  }, [items]);

  const handleAddLine = (category: ProjectItemCategory) => {
    setNewLineSections((prev) => ({
      ...prev,
      [category]: [...prev[category], createNewLineState()],
    }));
  };

  const handleRemoveLine = (category: ProjectItemCategory, lineId: string) => {
    setNewLineSections((prev) => {
      const updated = prev[category].filter((line) => line.id !== lineId);
      if (!updated.length && category === "products") {
        updated.push(createNewLineState());
      }
      return { ...prev, [category]: updated };
    });
  };

  const handleLineItemChange = (
    category: ProjectItemCategory,
    lineId: string,
    itemId: string,
  ) => {
    setNewLineSections((prev) => {
      const updated = prev[category].map((line) => {
        if (line.id !== lineId) return line;

        if (category === "products") {
          const item = items.find((i) => i.id === itemId);
          let mustHaveItemId: string | null = null;
          let mustHaveLabel: string | undefined;

          if (item?.mustHaveName) {
            const mustItem = items.find((i) => i.name === item.mustHaveName);
            if (mustItem) {
              mustHaveItemId = mustItem.id;
              mustHaveLabel = `${mustItem.name} (must have)`;
            }
          }

          return {
            ...line,
            itemId,
            mustHaveItemId,
            mustHaveLabel,
            mustHaveQty:
              mustHaveItemId != null
                ? line.mustHaveQty || line.qty || "1"
                : "",
          };
        }

        return {
          ...line,
          itemId,
          mustHaveItemId: null,
          mustHaveLabel: undefined,
          mustHaveQty: "",
        };
      });
      return { ...prev, [category]: updated };
    });
  };

  const handleLineQtyChange = (
    category: ProjectItemCategory,
    lineId: string,
    qty: string,
  ) => {
    setNewLineSections((prev) => ({
      ...prev,
      [category]: prev[category].map((line) =>
        line.id === lineId ? { ...line, qty } : line,
      ),
    }));
  };

  const handleLineMustHaveQtyChange = (lineId: string, qty: string) => {
    setNewLineSections((prev) => ({
      ...prev,
      products: prev.products.map((line) =>
        line.id === lineId ? { ...line, mustHaveQty: qty } : line,
      ),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setError("Project name is required.");
      return;
    }

    const structuredItems = createEmptyItemsByType();
    const optionMap = new Map(items.map((item) => [item.id, item]));

    const formCategories: ProjectItemCategory[] = [
      "products",
      "subAssemblies",
      "components",
      "sensors",
    ];

    formCategories.forEach((category) => {
      const sanitized: ProjectItemLine[] = newLineSections[category]
        .map((line) => {
          const qty = Number(line.qty);
          if (!line.itemId || !Number.isFinite(qty) || qty <= 0) {
            return null;
          }
          const option = optionMap.get(line.itemId);
          const projectLine: ProjectItemLine = {
            itemId: line.itemId,
            itemName: option?.name ?? "",
            qty,
            itemType: category,
          };
          if (
            category === "products" &&
            line.mustHaveItemId &&
            line.mustHaveItemId !== ""
          ) {
            const mustQty = Number(line.mustHaveQty);
            if (Number.isFinite(mustQty) && mustQty > 0) {
              const mustOption = optionMap.get(line.mustHaveItemId);
              projectLine.mustHaveItemId = line.mustHaveItemId;
              projectLine.mustHaveItemName =
                mustOption?.name ?? line.mustHaveLabel ?? null;
              projectLine.mustHaveQty = mustQty;
            }
          }
          return projectLine;
        })
        .filter((line): line is ProjectItemLine => Boolean(line));
      structuredItems[category] = sanitized;
    });

    const autoSensorExtras = new Map<
      string,
      { qty: number; fallbackName?: string }
    >();
    structuredItems.sensors.forEach((line) => {
      const option = optionMap.get(line.itemId);
      const extras = option?.mandatorySensorExtras ?? [];
      if (!extras.length) return;
      extras.forEach((extra) => {
        const qtyPerSensor =
          typeof extra.quantityPerSensor === "number" &&
          Number.isFinite(extra.quantityPerSensor) &&
          extra.quantityPerSensor > 0
            ? extra.quantityPerSensor
            : 1;
        const totalQty = qtyPerSensor * line.qty;
        if (!Number.isFinite(totalQty) || totalQty <= 0) {
          return;
        }
        const existing = autoSensorExtras.get(extra.sensorExtraId);
        autoSensorExtras.set(extra.sensorExtraId, {
          qty: (existing?.qty ?? 0) + totalQty,
          fallbackName: existing?.fallbackName ?? extra.name,
        });
      });
    });
    structuredItems.sensorExtras = Array.from(autoSensorExtras.entries())
      .map(([sensorExtraId, entry]) => {
        const option = optionMap.get(sensorExtraId);
        return {
          itemId: sensorExtraId,
          itemName: option?.name ?? entry.fallbackName ?? "Sensor extra",
          qty: entry.qty,
          itemType: "sensorExtras" as const,
        };
      })
      .filter((line) => Number.isFinite(line.qty) && line.qty > 0);

    const totalLines = formCategories.reduce(
      (sum, category) => sum + structuredItems[category].length,
      0,
    );
    if (!totalLines) {
      setError("Add at least one inventory item with a quantity.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const now = Timestamp.now();
      const linesForProject = flattenProjectItems(structuredItems);
      const itemsPayload = linesForProject.map((line) =>
        serializeProjectLine(line),
      );
      const itemsByTypePayload = PROJECT_ITEM_CATEGORIES.reduce(
        (acc, category) => {
          acc[category] = structuredItems[category].map((line) =>
            serializeProjectLine(line),
          );
          return acc;
        },
        {
          products: [] as ReturnType<typeof serializeProjectLine>[],
          subAssemblies: [] as ReturnType<typeof serializeProjectLine>[],
          components: [] as ReturnType<typeof serializeProjectLine>[],
          sensors: [] as ReturnType<typeof serializeProjectLine>[],
          sensorExtras: [] as ReturnType<typeof serializeProjectLine>[],
        } as Record<
          ProjectItemCategory,
          ReturnType<typeof serializeProjectLine>[]
        >,
      );

      await addDoc(collection(db, "projects"), {
        name: newName.trim(),
        status: "reserved" as const,
        hubspotDealId: newDealId.trim() || null,
        items: itemsPayload,
        itemsByType: itemsByTypePayload,
        createdAt: now,
        updatedAt: now,
      });

      const batch = writeBatch(db);
      linesForProject.forEach((line) => {
        if (!line.itemId || !line.qty) return;
        const itemRef = doc(db, "items", line.itemId);
        batch.update(itemRef, {
          inventoryQty: increment(-line.qty),
          reservedQty: increment(line.qty),
          updatedAt: now,
        });

        if (line.mustHaveItemId && line.mustHaveQty && line.mustHaveQty > 0) {
          const mustRef = doc(db, "items", line.mustHaveItemId);
          batch.update(mustRef, {
            inventoryQty: increment(-line.mustHaveQty),
            reservedQty: increment(line.mustHaveQty),
            updatedAt: now,
          });
        }
      });
      await batch.commit();

      router.push("/projects");
    } catch (err: any) {
      console.error("Error creating project", err);
      setError(err?.message ?? "Unable to create project.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="ims-content">
      <section className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Create project</h1>
          <p className="ims-page-subtitle">
            Reserve finished goods plus any supporting assemblies, components
            and sensors. Inventory moves from on-hand to reserved immediately.
          </p>
        </div>
        <div className="ims-page-actions" style={{ gap: "0.5rem" }}>
          <button
            type="button"
            className="ims-secondary-button"
            onClick={() => router.push("/projects")}
          >
            ← Back to board
          </button>
          <button
            type="submit"
            form="new-project-form"
            className="ims-primary-button"
            disabled={saving || loadingItems}
          >
            {saving ? "Creating…" : "Create project"}
          </button>
        </div>
      </section>

      {error && (
        <div className="ims-alert ims-alert--error">{error}</div>
      )}

      {loadingItems ? (
        <p>Loading inventory options…</p>
      ) : (
        <form
          id="new-project-form"
          className="ims-form-section card"
          onSubmit={handleSubmit}
        >
          <div className="ims-field">
            <label className="ims-field-label" htmlFor="projName">
              Project name<span className="ims-required">*</span>
            </label>
            <input
              id="projName"
              className="ims-field-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>

          <div className="ims-field">
            <label className="ims-field-label" htmlFor="dealId">
              HubSpot Project ID
            </label>
            <input
              id="dealId"
              className="ims-field-input"
              value={newDealId}
              onChange={(e) => setNewDealId(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <hr className="ims-form-divider" />

          <div className="ims-field">
            <div className="ims-form-section-title">
              {SECTION_COPY.products.title}
            </div>
            <p className="ims-form-section-subtitle">
              {SECTION_COPY.products.subtitle}
            </p>
          </div>

          {newLineSections.products.map((line, index) => (
            <div key={line.id} className="ims-field ims-project-line">
              <div className="ims-field-row">
                <div className="ims-field">
                  <label className="ims-field-label">
                    Product {index + 1}
                  </label>
                  <select
                    className="ims-field-input"
                    value={line.itemId}
                    onChange={(e) =>
                      handleLineItemChange("products", line.id, e.target.value)
                    }
                  >
                    <option value="">Select a product…</option>
                    {itemsByCategory.products.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.sku})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ims-field">
                  <label className="ims-field-label">Quantity</label>
                  <input
                    type="number"
                    min={1}
                    className="ims-field-input"
                    value={line.qty}
                    onChange={(e) =>
                      handleLineQtyChange("products", line.id, e.target.value)
                    }
                  />
                </div>
              </div>

              {line.mustHaveItemId && line.mustHaveLabel && (
                <div className="ims-field-row">
                  <div className="ims-field">
                    <label className="ims-field-label">
                      {line.mustHaveLabel}
                    </label>
                    <div className="ims-field-help">
                      This product is required whenever the main product is
                      used.
                    </div>
                  </div>
                  <div className="ims-field">
                    <label className="ims-field-label">
                      Required quantity
                    </label>
                    <input
                      type="number"
                      min={1}
                      className="ims-field-input"
                      value={line.mustHaveQty}
                      onChange={(e) =>
                        handleLineMustHaveQtyChange(line.id, e.target.value)
                      }
                    />
                  </div>
                </div>
              )}

              {newLineSections.products.length > 1 && (
                <button
                  type="button"
                  className="ims-secondary-button ims-project-line-remove"
                  onClick={() => handleRemoveLine("products", line.id)}
                >
                  Remove line
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            className="ims-secondary-button"
            onClick={() => handleAddLine("products")}
            style={{ marginTop: "0.5rem" }}
          >
            + {SECTION_COPY.products.addLabel}
          </button>

          {SECONDARY_SECTIONS.map((category) => {
            const lines = newLineSections[category];
            return (
              <div key={category}>
                <hr className="ims-form-divider" />
                <div className="ims-field">
                  <div className="ims-form-section-title">
                    {SECTION_COPY[category].title}
                  </div>
                  <p className="ims-form-section-subtitle">
                    {SECTION_COPY[category].subtitle}
                  </p>
                </div>
                {lines.length === 0 && (
                  <p className="ims-table-empty">
                    {SECTION_COPY[category].empty}
                  </p>
                )}
                {lines.map((line, index) => (
                  <div key={line.id} className="ims-field ims-project-line">
                    <div className="ims-field-row">
                      <div className="ims-field">
                        <label className="ims-field-label">
                          {PROJECT_ITEM_LABELS[category]} {index + 1}
                        </label>
                        <select
                          className="ims-field-input"
                          value={line.itemId}
                          onChange={(e) =>
                            handleLineItemChange(
                              category,
                              line.id,
                              e.target.value,
                            )
                          }
                        >
                          <option value="">
                            Select a{" "}
                            {PROJECT_ITEM_LABELS[category].toLowerCase()}
                            …
                          </option>
                          {itemsByCategory[category].map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.sku})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="ims-field">
                        <label className="ims-field-label">Quantity</label>
                        <input
                          type="number"
                          min={1}
                          className="ims-field-input"
                          value={line.qty}
                          onChange={(e) =>
                            handleLineQtyChange(
                              category,
                              line.id,
                              e.target.value,
                            )
                          }
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ims-secondary-button ims-project-line-remove"
                      onClick={() => handleRemoveLine(category, line.id)}
                    >
                      Remove line
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="ims-secondary-button"
                  onClick={() => handleAddLine(category)}
                  style={{ marginTop: "0.5rem" }}
                >
                  + {SECTION_COPY[category].addLabel}
                </button>
              </div>
            );
          })}
        </form>
      )}
    </main>
  );
}
