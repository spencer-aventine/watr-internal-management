"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  arrayUnion,
  writeBatch,
  increment,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  getInventoryDetailPath,
  type InventoryDetailType,
  normalizeItemType,
} from "@/lib/inventoryPaths";
import { useAuth } from "@/app/_components/AuthProvider";

type RelationshipEntry = {
  id: string;
  name: string;
  sku?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  total?: number | null;
  mandatory?: boolean;
  note?: string | null;
  type?: InventoryDetailType | null;
};

type InventoryHistoryPoint = {
  id: string;
  at: Date;
  bucket?: string | null;
  quantity?: number | null;
  delta?: number | null;
  reference?: string | null;
  note?: string | null;
  changeType?: string | null;
  fromBucket?: string | null;
  toBucket?: string | null;
};

type PurchaseStatus = "draft" | "paid" | "stock_received";

type PurchaseOrderSummary = {
  id: string;
  vendorName: string;
  reference?: string | null;
  qty: number;
  status: PurchaseStatus;
  proposedDeliveryDate?: Timestamp | null;
};

type InventoryItem = {
  id: string;
  name: string;
  sku: string;
  shortCode?: string | null;
  description?: string | null;
  itemType?: string | null;
  category?: string | null;
  status?: string | null;
  unitOfMeasure?: string | null;
  trackSerialNumber: boolean;
  standardCost?: number | null;
  standardCostCurrency?: string | null;
  pricePerUnit?: number | null;
  estimatedComponentCost?: number | null;
  totalCost?: number | null;
  reorderLevel?: number | null;
  reorderQuantity?: number | null;
  usefulLifeMonths?: number | null;
  annualReplacementFrequency?: number | null;
  supplier1?: string | null;
  supplier2?: string | null;
  hubspotProductId?: string | null;
  xeroItemCode?: string | null;
  primaryCategoryId?: string | null;
  subCategoryIds: string[];
  inventoryQty?: number | null;
  reservedQty?: number | null;
  wipQty?: number | null;
  completedQty?: number | null;
  lowStockThreshold?: number | null;
  components: RelationshipEntry[];
  subAssemblies: RelationshipEntry[];
  sensors: RelationshipEntry[];
  sensorExtras: RelationshipEntry[];
  mandatorySensors: RelationshipEntry[];
  mandatorySensorExtras: RelationshipEntry[];
  inventoryHistory: InventoryHistoryPoint[];
};

type ComponentOption = {
  id: string;
  name: string;
  sku?: string | null;
  unitPrice?: number | null;
};

type DetailCopy = {
  heading: string;
  description: string;
  singular: string;
};

const detailCopy: Record<InventoryDetailType, DetailCopy> = {
  products: {
    heading: "Product detail",
    description:
      "Full build documentation for the shipment-ready unit, including structure, costs and stock.",
    singular: "Product",
  },
  subAssemblies: {
    heading: "Sub-assembly detail",
    description:
      "Break down sub-assemblies into their component parts and monitor costs before they roll into a product.",
    singular: "Sub-assembly",
  },
  components: {
    heading: "Component detail",
    description:
      "Track the component specification, costing and how stock moves over time.",
    singular: "Component",
  },
  sensors: {
    heading: "Sensor detail",
    description:
      "See the dependencies for this sensor and which other sensors are mandatory when it is deployed.",
    singular: "Sensor",
  },
  sensorExtras: {
    heading: "Sensor extra detail",
    description:
      "Understand which sensors rely on this extra kit and keep tabs on the supporting stock.",
    singular: "Sensor extra",
  },
};

const formatCurrency = (
  value?: number | null,
  currency: string = "GBP",
): string => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatNumber = (value?: number | null): string => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 2,
  }).format(value);
};

const parseNumber = (value: any): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const next = Number(value);
    return Number.isFinite(next) ? next : null;
  }
  return null;
};

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseRelationshipArray = (
  value: any,
  fallbackType?: InventoryDetailType,
): RelationshipEntry[] => {
  if (!Array.isArray(value)) return [];
  const relationships: RelationshipEntry[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const id =
      (entry.itemId ??
        entry.componentId ??
        entry.subAssemblyId ??
        entry.subassemblyId ??
        entry.sensorId ??
        entry.sensorExtraId ??
        entry.id ??
        entry.referenceId ??
        entry.code ??
        "") || `rel-${index}`;
    const quantity = parseNumber(entry.quantity ?? entry.qty);
    const unitPrice = parseNumber(
      entry.unitPrice ?? entry.price ?? entry.cost ?? entry.standardCost,
    );
    const total =
      parseNumber(entry.lineTotal ?? entry.total) ??
      (typeof quantity === "number" && typeof unitPrice === "number"
        ? quantity * unitPrice
        : null);
    relationships.push({
      id: String(id),
      name:
        entry.name ??
        entry.itemName ??
        entry.componentName ??
        entry.subAssemblyName ??
        entry.sku ??
        "Unnamed item",
      sku: entry.sku ?? entry.code ?? entry.partCode ?? null,
      quantity: quantity ?? null,
      unitPrice: unitPrice ?? null,
      total: total ?? null,
      mandatory: Boolean(
        entry.mandatory ??
          entry.required ??
          entry.isMandatory ??
          entry.mandatorySensor,
      ),
      note: entry.note ?? entry.notes ?? null,
      type: (entry.type ?? entry.itemType ?? fallbackType ?? null) as
        | InventoryDetailType
        | null,
    });
  });
  return relationships;
};

const parseInventoryHistory = (value: any): InventoryHistoryPoint[] => {
  if (!Array.isArray(value)) return [];
  const entries = value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const timestamp =
        entry.timestamp ?? entry.at ?? entry.date ?? entry.recordedAt ?? null;
      const at = toDate(timestamp);
      if (!at) return null;
      return {
        id: String(entry.id ?? `movement-${index}`),
        at,
        bucket: entry.bucket ?? entry.type ?? entry.bucketName ?? null,
        quantity:
          parseNumber(entry.quantity ?? entry.onHand ?? entry.balance) ?? null,
        delta: parseNumber(entry.delta ?? entry.change ?? entry.qtyChange),
        reference: entry.reference ?? entry.source ?? entry.reason ?? null,
        note: entry.note ?? entry.comment ?? null,
        changeType: entry.changeType ?? entry.movementType ?? entry.kind ?? entry.reasonType ?? null,
        fromBucket:
          entry.fromBucket ??
          entry.sourceBucket ??
          entry.from ??
          (typeof (entry.bucket ?? entry.bucketName) === "string" &&
          String(entry.bucket ?? entry.bucketName).includes("→")
            ? String(entry.bucket ?? entry.bucketName).split("→")[0].trim()
            : null),
        toBucket:
          entry.toBucket ??
          entry.destinationBucket ??
          entry.to ??
          (typeof (entry.bucket ?? entry.bucketName) === "string" &&
          String(entry.bucket ?? entry.bucketName).includes("→")
            ? String(entry.bucket ?? entry.bucketName).split("→")[1]?.trim() ?? null
            : null),
      };
    })
    .filter((entry): entry is InventoryHistoryPoint => Boolean(entry));
  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
};

const mapItemSnapshot = (snap: any): InventoryItem => {
  const data = snap.data() as any;
  return {
    id: snap.id,
    name: data.name ?? data.title ?? "Untitled item",
    sku: data.sku ?? data.shortCode ?? data.code ?? "—",
    shortCode: data.shortCode ?? null,
    description: data.description ?? data.notes ?? "",
    itemType: data.itemType ?? data.rawCsvItemType ?? null,
    category: data.category ?? null,
    status: data.status ?? data.lifecycleStatus ?? null,
    unitOfMeasure: data.unitOfMeasure ?? data.unit ?? null,
    trackSerialNumber: Boolean(data.trackSerialNumber),
    standardCost: parseNumber(data.standardCost),
    standardCostCurrency: data.standardCostCurrency ?? data.currency ?? "GBP",
    pricePerUnit: parseNumber(data.pricePerUnit ?? data.salesPrice),
    estimatedComponentCost: parseNumber(data.estimatedComponentCost),
    totalCost: parseNumber(data.totalCost),
    reorderLevel: parseNumber(data.reorderLevel),
    reorderQuantity: parseNumber(data.reorderQuantity),
    usefulLifeMonths: parseNumber(data.usefulLifeMonths),
    annualReplacementFrequency: parseNumber(
      data.annualReplacementFrequency ??
        data.sensorReplacementFrequency ??
        data.replacementFrequency,
    ),
    supplier1: data.supplier1 ?? data.primarySupplier ?? null,
    supplier2: data.supplier2 ?? data.secondarySupplier ?? null,
    hubspotProductId: data.hubspotProductId ?? null,
    xeroItemCode: data.xeroItemCode ?? data.xeroItem ?? null,
    primaryCategoryId: data.primaryCategoryId ?? null,
    subCategoryIds: Array.isArray(data.subCategoryIds)
      ? data.subCategoryIds.map((id: any) => String(id))
      : [],
    inventoryQty: parseNumber(data.inventoryQty),
    reservedQty: parseNumber(data.reservedQty),
    wipQty: parseNumber(data.wipQty),
    completedQty: parseNumber(data.completedQty),
    lowStockThreshold: parseNumber(data.lowStockThreshold),
    components: parseRelationshipArray(data.components, "components"),
    subAssemblies: parseRelationshipArray(
      data.subAssemblies ?? data.subAssemblyStructure ?? data.assemblies,
      "subAssemblies",
    ),
    sensors: parseRelationshipArray(
      data.sensors ?? data.sensorRequirements ?? data.sensorStructure,
      "sensors",
    ),
    sensorExtras: parseRelationshipArray(
      data.sensorExtras ?? data.extras ?? data.sensorExtraStructure,
      "sensorExtras",
    ),
    mandatorySensors: parseRelationshipArray(
      data.mandatorySensors ?? data.requiredSensors ?? data.sensorRequirements,
      "sensors",
    ),
    mandatorySensorExtras: parseRelationshipArray(
      data.mandatorySensorExtras ?? data.requiredSensorExtras,
      "sensorExtras",
    ),
    inventoryHistory: parseInventoryHistory(
      data.inventoryHistory ?? data.inventoryMovements ?? data.inventorySnapshots,
    ),
  };
};

const StatusTag = ({ status }: { status?: string | null }) => {
  if (!status) return <span>—</span>;
  const normalized = status.toString().toLowerCase();
  const isActive = normalized === "active";
  const className = isActive
    ? "ims-status-tag ims-status-tag--active"
    : "ims-status-tag ims-status-tag--inactive";
  return <span className={className}>{status}</span>;
};

type RelationshipTableProps = {
  title: string;
  subtitle?: string;
  items: RelationshipEntry[];
  emptyLabel: string;
  fallbackType?: InventoryDetailType;
};

const RelationshipTable = ({
  title,
  subtitle,
  items,
  emptyLabel,
  fallbackType,
}: RelationshipTableProps) => (
  <section className="ims-form-section card">
    <div className="ims-table-header">
      <div>
        <h2 className="ims-form-section-title">{title}</h2>
        {subtitle && (
          <p className="ims-form-section-subtitle">{subtitle}</p>
        )}
      </div>
      <div>
        <span className="ims-table-count">
          {items.length
            ? `${items.length} item${items.length === 1 ? "" : "s"}`
            : "No items"}
        </span>
      </div>
    </div>
    {items.length ? (
      <div className="ims-table-wrapper">
        <table className="ims-table ims-table--compact">
          <thead>
            <tr>
              <th style={{ width: "40%" }}>Name</th>
              <th>Qty</th>
              <th>Unit cost</th>
              <th>Total</th>
              <th>Mandatory</th>
            </tr>
          </thead>
          <tbody>
            {items.map((entry) => {
              const normalizedId = entry.id || "";
              const hasValidId =
                Boolean(normalizedId) && !normalizedId.startsWith("rel-");
              const targetType = entry.type ?? fallbackType ?? null;
              const href = hasValidId
                ? getInventoryDetailPath(normalizedId, targetType, targetType)
                : null;
              return (
                <tr key={entry.id}>
                  <td>
                    {href ? (
                      <Link href={href} className="ims-table-link">
                        {entry.name}
                      </Link>
                    ) : (
                      entry.name
                    )}
                    {entry.sku && (
                      <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                        {entry.sku}
                      </div>
                    )}
                    {entry.note && (
                      <div
                        style={{ fontSize: "0.75rem", color: "#4b5563" }}
                      >
                        {entry.note}
                      </div>
                    )}
                  </td>
                  <td>{formatNumber(entry.quantity)}</td>
                  <td>{formatCurrency(entry.unitPrice)}</td>
                  <td>{formatCurrency(entry.total)}</td>
                  <td>
                    {typeof entry.mandatory === "boolean"
                      ? entry.mandatory
                        ? "Yes"
                        : "Optional"
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="ims-table-empty">{emptyLabel}</p>
    )}
  </section>
);

const InventorySnapshotCard = ({
  item,
  detailType,
  canEdit,
  isAdmin,
  onUpdated,
}: {
  item: InventoryItem;
  detailType: InventoryDetailType;
  canEdit: boolean;
  isAdmin: boolean;
  onUpdated: () => void;
}) => {
  const buckets = [
    { label: "Inventory", value: item.inventoryQty },
    { label: "Reserved", value: item.reservedQty },
    { label: "WIP", value: item.wipQty },
    { label: "Completed", value: item.completedQty },
  ];
  const totalStock = buckets.reduce(
    (sum, bucket) => sum + (bucket.value ?? 0),
    0,
  );
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lowStockValue, setLowStockValue] = useState(
    item.lowStockThreshold != null ? String(item.lowStockThreshold) : "",
  );
  const allowEditing = detailType === "components" && canEdit && isAdmin;

  useEffect(() => {
    setLowStockValue(
      item.lowStockThreshold != null ? String(item.lowStockThreshold) : "",
    );
  }, [item.lowStockThreshold]);

  useEffect(() => {
    if (!allowEditing && editing) {
      setEditing(false);
    }
  }, [allowEditing, editing]);

  const lowStockDisplay = editing
    ? lowStockValue.trim() || "—"
    : formatNumber(item.lowStockThreshold);

  const handleCancel = () => {
    setEditing(false);
    setFormError(null);
    setLowStockValue(
      item.lowStockThreshold != null ? String(item.lowStockThreshold) : "",
    );
  };

  const handleSave = async () => {
    setFormError(null);
    const trimmed = lowStockValue.trim();
    const nextValue =
      trimmed === ""
        ? null
        : Number(trimmed);
    if (
      nextValue != null &&
      (!Number.isFinite(nextValue) || nextValue < 0)
    ) {
      setFormError("Low-stock threshold must be zero or a positive number.");
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, "items", item.id), {
        lowStockThreshold: nextValue,
        updatedAt: Timestamp.now(),
      });
      setEditing(false);
      onUpdated();
    } catch (err: any) {
      console.error("Error updating low-stock threshold", err);
      setFormError(
        err?.message ?? "Unable to update the low-stock threshold.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="ims-form-section card">
      <div className="ims-table-header">
        <div>
          <h2 className="ims-form-section-title">Inventory snapshot</h2>
          <p className="ims-form-section-subtitle">
            Live quantities across the four buckets plus the low-stock trigger.
          </p>
        </div>
        {allowEditing && (
          <div className="ims-page-actions" style={{ gap: "0.5rem" }}>
            {editing ? (
              <>
                <button
                  type="button"
                  className="ims-secondary-button"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ims-primary-button"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save threshold"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ims-secondary-button"
                onClick={() => setEditing(true)}
              >
                Edit low stock
              </button>
            )}
          </div>
        )}
      </div>
      {formError && (
        <div
          className="ims-alert ims-alert--error"
          style={{ marginBottom: "0.75rem" }}
        >
          {formError}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "0.75rem",
        }}
      >
        {buckets.map((bucket) => (
          <div
            key={bucket.label}
            className="card"
            style={{ padding: "0.65rem" }}
          >
            <div className="ims-metric-label">{bucket.label}</div>
            <div className="ims-metric-value">
              {formatNumber(bucket.value)}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: "0.9rem" }}>
        <div className="ims-metric-label">Total on hand</div>
        <div className="ims-metric-value">{formatNumber(totalStock)}</div>
        <div className="ims-metric-note">
          Low-stock threshold: {lowStockDisplay}
        </div>
      </div>
      {editing && (
        <div className="ims-field" style={{ marginTop: "0.9rem" }}>
          <label className="ims-field-label" htmlFor="lowStockThreshold">
            Low-stock threshold
          </label>
          <input
            id="lowStockThreshold"
            type="number"
            min="0"
            className="ims-field-input"
            value={lowStockValue}
            onChange={(e) => setLowStockValue(e.target.value)}
            disabled={saving}
          />
          <p className="ims-field-help">
            Configure the alert threshold for this component. Leave blank to
            clear the threshold.
          </p>
        </div>
      )}
    </section>
  );
};

const CostingCard = ({ item }: { item: InventoryItem }) => {
  const rows: { label: string; value: number | null; type: "currency" | "qty" }[] =
    [
      { label: "Standard cost", value: item.standardCost ?? null, type: "currency" },
      { label: "List price", value: item.pricePerUnit ?? null, type: "currency" },
      {
        label: "Estimated component cost",
        value: item.estimatedComponentCost ?? null,
        type: "currency",
      },
      { label: "Total cost", value: item.totalCost ?? null, type: "currency" },
      { label: "Reorder level", value: item.reorderLevel ?? null, type: "qty" },
      {
        label: "Reorder quantity",
        value: item.reorderQuantity ?? null,
        type: "qty",
      },
    ];
  const hasData = rows.some(
    (row) => typeof row.value === "number" && Number.isFinite(row.value),
  );
  return (
    <section className="ims-form-section card">
      <h2 className="ims-form-section-title">Costing & supply</h2>
      <p className="ims-form-section-subtitle">
        Reference costs when quoting or forecasting stock requirements.
      </p>
      {hasData ? (
        <table className="ims-table ims-table--compact">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                <td>
                  {row.type === "currency"
                    ? formatCurrency(row.value, item.standardCostCurrency ?? "GBP")
                    : formatNumber(row.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="ims-table-empty">No costing data recorded yet.</p>
      )}
    </section>
  );
};

const PurchasePipelineCard = ({
  stats,
  loading,
  error,
  itemName,
}: {
  stats: {
    totalQty: number;
    draftQty: number;
    paidQty: number;
    orders: PurchaseOrderSummary[];
  } | null;
  loading: boolean;
  error: string | null;
  itemName: string;
}) => {
  const formatDateShort = (timestamp?: Timestamp | null) => {
    if (!timestamp) return "—";
    try {
      return timestamp.toDate().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    } catch {
      return "—";
    }
  };

  return (
    <section className="ims-form-section card">
      <h2 className="ims-form-section-title">Purchase orders</h2>
      <p className="ims-form-section-subtitle">
        Draft and paid orders for {itemName}, covering what is coming into stock.
      </p>
      {error && (
        <div className="ims-alert ims-alert--error" style={{ marginBottom: "0.75rem" }}>
          {error}
        </div>
      )}
      {loading ? (
        <p className="ims-table-empty">Loading purchase pipeline…</p>
      ) : !stats || stats.orders.length === 0 ? (
        <p className="ims-table-empty">No purchase orders reference this item yet.</p>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "0.75rem",
              marginBottom: "0.9rem",
            }}
          >
            <div className="card" style={{ padding: "0.65rem" }}>
              <div className="ims-metric-label">Total ordered</div>
              <div className="ims-metric-value">
                {formatNumber(stats.totalQty)}
              </div>
            </div>
            <div className="card" style={{ padding: "0.65rem" }}>
              <div className="ims-metric-label">Draft</div>
              <div className="ims-metric-value">
                {formatNumber(stats.draftQty)}
              </div>
            </div>
            <div className="card" style={{ padding: "0.65rem" }}>
              <div className="ims-metric-label">Paid</div>
              <div className="ims-metric-value">
                {formatNumber(stats.paidQty)}
              </div>
            </div>
          </div>
          <div className="ims-table-wrapper">
            <table className="ims-table ims-table--compact">
              <thead>
                <tr>
                  <th>Purchase</th>
                  <th>Status</th>
                  <th>Qty</th>
                  <th>Proposed delivery</th>
                </tr>
              </thead>
              <tbody>
                {stats.orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link
                        href={`/purchasing/${order.id}`}
                        className="ims-table-link"
                      >
                        {order.vendorName}
                      </Link>
                      <div style={{ fontSize: "0.8rem", color: "#4b5563" }}>
                        {order.reference || "No reference"}
                      </div>
                    </td>
                    <td style={{ textTransform: "capitalize" }}>
                      {order.status.replace("_", " ")}
                    </td>
                    <td>{formatNumber(order.qty)}</td>
                    <td>{formatDateShort(order.proposedDeliveryDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};

const InventoryHistoryCard = ({ item }: { item: InventoryItem }) => {
  if (!item.inventoryHistory.length) {
    return (
      <section className="ims-form-section card">
        <h2 className="ims-form-section-title">Inventory movement</h2>
        <p className="ims-form-section-subtitle">
          Each increase or decrease in stock will appear here once transactions
          are synced.
        </p>
        <p className="ims-table-empty">No recorded inventory movement.</p>
      </section>
    );
  }
  const latest = item.inventoryHistory.slice(0, 10);
  return (
    <section className="ims-form-section card">
      <h2 className="ims-form-section-title">Inventory movement</h2>
      <p className="ims-form-section-subtitle">
        Ten most recent changes showing the quantity moved, source, destination and reason.
      </p>
      <div className="ims-table-wrapper">
        <table className="ims-table ims-table--compact">
          <thead>
            <tr>
              <th style={{ width: "20%" }}>When</th>
              <th style={{ width: "15%" }}>Type</th>
              <th>Change</th>
              <th style={{ width: "25%" }}>Route</th>
            </tr>
          </thead>
          <tbody>
            {latest.map((entry) => {
              const delta =
                typeof entry.delta === "number"
                  ? `${entry.delta > 0 ? "+" : ""}${formatNumber(entry.delta)}`
                  : "—";
              const reference = entry.reference || entry.note || "—";
              const route =
                entry.fromBucket || entry.toBucket
                  ? `${entry.fromBucket ?? "—"} → ${entry.toBucket ?? "—"}`
                  : entry.bucket ?? "—";
              const derivedType =
                entry.changeType ??
                (reference?.toLowerCase().includes("purchase")
                  ? "purchase"
                  : reference?.toLowerCase().includes("project")
                    ? "project"
                    : reference?.toLowerCase().includes("manufacture")
                      ? "subAssembly"
                      : null);
              const changeTypeLabel = derivedType
                ? derivedType.replace(/([a-z])([A-Z])/g, "$1 $2")
                : "—";
              return (
                <tr key={entry.id}>
                  <td>
                    {entry.at.toLocaleString("en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td style={{ textTransform: "capitalize" }}>{changeTypeLabel}</td>
                  <td>{delta} · {reference}</td>
                  <td>{route}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const SensorReplacementCard = ({
  item,
  onUpdated,
  canEdit,
  detailType,
}: {
  item: InventoryItem;
  onUpdated: () => void;
  canEdit: boolean;
  detailType: "sensors" | "sensorExtras";
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState<string>(
    item.annualReplacementFrequency != null
      ? String(item.annualReplacementFrequency)
      : "",
  );

  useEffect(() => {
    setDraftValue(
      item.annualReplacementFrequency != null
        ? String(item.annualReplacementFrequency)
        : "",
    );
  }, [item.annualReplacementFrequency]);

  useEffect(() => {
    if (!canEdit && editing) {
      setEditing(false);
    }
  }, [canEdit, editing]);

  const handleCancel = () => {
    setEditing(false);
    setFormError(null);
    setDraftValue(
      item.annualReplacementFrequency != null
        ? String(item.annualReplacementFrequency)
        : "",
    );
  };

  const handleSave = async () => {
    setFormError(null);
    const trimmed = draftValue.trim();
    let nextValue: number | null = null;
    if (trimmed) {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setFormError("Enter a number greater than or equal to zero.");
        return;
      }
      nextValue = parsed;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, "items", item.id), {
        annualReplacementFrequency: nextValue,
        updatedAt: Timestamp.now(),
      });
      setEditing(false);
      onUpdated();
    } catch (err: any) {
      console.error("Error updating replacement frequency", err);
      setFormError(
        err?.message ?? "Unable to update the annual replacement frequency.",
      );
    } finally {
      setSaving(false);
    }
  };

  const hasValue =
    typeof item.annualReplacementFrequency === "number" &&
    Number.isFinite(item.annualReplacementFrequency);
  const isSensorExtra = detailType === "sensorExtras";
  const heading = isSensorExtra
    ? "Annual replenishment frequency"
    : "Annual replacement frequency";
  const description = isSensorExtra
    ? "Track how many times per year this sensor extra should be replenished in the field."
    : "Track how many times per year this sensor should be replaced in the field.";
  const fieldLabel = isSensorExtra
    ? "Replenishments per year"
    : "Replacements per year";
  const recordedLabel = isSensorExtra
    ? "Recorded replenishment cadence"
    : "Recorded replacement cadence";
  const emptyCopy = isSensorExtra
    ? "No replenishment cadence recorded yet."
    : "No replacement cadence recorded yet.";

  return (
    <section className="ims-form-section card">
      <div className="ims-table-header">
        <div>
          <h2 className="ims-form-section-title">{heading}</h2>
          <p className="ims-form-section-subtitle">{description}</p>
        </div>
        <div className="ims-page-actions" style={{ gap: "0.5rem" }}>
          {editing ? (
            <>
              <button
                type="button"
                className="ims-secondary-button"
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ims-primary-button"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save frequency"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ims-secondary-button"
              onClick={() => setEditing(true)}
              disabled={!canEdit}
            >
              Edit frequency
            </button>
          )}
        </div>
      </div>
      {formError && (
        <div className="ims-alert ims-alert--error" style={{ marginBottom: "0.75rem" }}>
          {formError}
        </div>
      )}
      {editing ? (
        <div className="ims-field" style={{ maxWidth: 240 }}>
          <label className="ims-field-label" htmlFor="annualReplacementFrequency">
            {fieldLabel}
          </label>
          <input
            id="annualReplacementFrequency"
            type="number"
            min="0"
            step="0.01"
            className="ims-field-input"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            disabled={!canEdit}
          />
          <p className="ims-field-help">
            Use decimals if this item is replaced less than once per year.
          </p>
        </div>
      ) : hasValue ? (
        <div>
          <div className="ims-metric-label">{recordedLabel}</div>
          <div className="ims-metric-value">
            {formatNumber(item.annualReplacementFrequency)} per year
          </div>
        </div>
      ) : (
        <p className="ims-table-empty">{emptyCopy}</p>
      )}
    </section>
  );
};

type SensorExtraOption = {
  id: string;
  name: string;
  sku?: string | null;
};

const MandatorySensorExtrasCard = ({
  item,
  extras,
  options,
  onUpdated,
  canEdit,
}: {
  item: InventoryItem;
  extras: RelationshipEntry[];
  options: SensorExtraOption[];
  onUpdated: () => void;
  canEdit: boolean;
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RelationshipEntry[]>(extras);

  useEffect(() => {
    setDraft(extras);
  }, [extras]);

  useEffect(() => {
    if (!canEdit && editing) {
      setEditing(false);
    }
  }, [canEdit, editing]);

  const availableOptions = options.filter(
    (option) => !draft.some((entry) => entry.id === option.id),
  );

  const handleAdd = (optionId: string) => {
    if (!optionId) return;
    const option = options.find((opt) => opt.id === optionId);
    if (!option) return;
    setDraft((prev) => [
      ...prev,
      {
        id: option.id,
        name: option.name,
        sku: option.sku ?? null,
        mandatory: true,
        type: "sensorExtras",
      },
    ]);
  };

  const handleRemove = (entryId: string) => {
    setDraft((prev) => prev.filter((entry) => entry.id !== entryId));
  };

  const handleSave = async () => {
    setFormError(null);
    setSaving(true);
    try {
      const payload = draft.map((entry) => ({
        sensorExtraId: entry.id,
        name: entry.name,
        sku: entry.sku ?? null,
        mandatory: true,
      }));
      await updateDoc(doc(db, "items", item.id), {
        mandatorySensorExtras: payload,
        updatedAt: Timestamp.now(),
      });
      setEditing(false);
      onUpdated();
    } catch (err: any) {
      console.error("Error updating mandatory sensor extras", err);
      setFormError(err?.message ?? "Unable to update sensor extras.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setFormError(null);
    setDraft(extras);
  };

  return (
    <section className="ims-form-section card">
      <div className="ims-table-header">
        <div>
          <h2 className="ims-form-section-title">Mandatory sensor extras</h2>
          <p className="ims-form-section-subtitle">
            Choose the extras that must accompany this sensor whenever it is shipped.
          </p>
        </div>
        <div className="ims-page-actions" style={{ gap: "0.5rem" }}>
          {editing ? (
            <>
              <button
                type="button"
                className="ims-secondary-button"
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ims-primary-button"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save extras"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ims-secondary-button"
              onClick={() => setEditing(true)}
              disabled={!canEdit}
            >
              Edit extras
            </button>
          )}
        </div>
      </div>
      {formError && (
        <div className="ims-alert ims-alert--error" style={{ marginBottom: "0.75rem" }}>
          {formError}
        </div>
      )}
      {editing && (
        <div className="ims-field" style={{ maxWidth: 360 }}>
          <label className="ims-field-label" htmlFor="sensorExtraSelect">
            Add sensor extra
          </label>
          <select
            id="sensorExtraSelect"
            className="ims-field-input"
            onChange={(e) => {
              handleAdd(e.target.value);
              e.target.value = "";
            }}
            defaultValue=""
            disabled={!canEdit}
          >
            <option value="">Select extra…</option>
            {availableOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.sku ? ` (${option.sku})` : ""}
              </option>
            ))}
          </select>
          {!availableOptions.length && (
            <p className="ims-field-help">
              All sensor extras are already selected for this sensor.
            </p>
          )}
        </div>
      )}
      {draft.length ? (
        <div className="ims-table-wrapper">
          <table className="ims-table ims-table--compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>SKU</th>
                {editing && <th />}
              </tr>
            </thead>
            <tbody>
              {draft.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.name}</td>
                  <td>{entry.sku ?? "—"}</td>
                  {editing && (
                    <td>
                      <button
                        type="button"
                        className="ims-table-link"
                        onClick={() => handleRemove(entry.id)}
                        disabled={!canEdit}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ims-table-empty">No sensor extras selected yet.</p>
      )}
    </section>
  );
};

const SummaryCard = ({
  item,
  detailLabel,
  detailType,
  canEdit,
  isAdmin,
  onUpdated,
}: {
  item: InventoryItem;
  detailLabel: string;
  detailType: InventoryDetailType;
  canEdit: boolean;
  isAdmin: boolean;
  onUpdated: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: item.name ?? "",
    shortCode: item.shortCode ?? "",
    category: item.category ?? "",
    supplier1: item.supplier1 ?? "",
    supplier2: item.supplier2 ?? "",
    description: item.description ?? "",
    usefulLifeMonths:
      item.usefulLifeMonths != null ? String(item.usefulLifeMonths) : "",
  });

  useEffect(() => {
    setForm({
      name: item.name ?? "",
      shortCode: item.shortCode ?? "",
      category: item.category ?? "",
      supplier1: item.supplier1 ?? "",
      supplier2: item.supplier2 ?? "",
      description: item.description ?? "",
      usefulLifeMonths:
        item.usefulLifeMonths != null ? String(item.usefulLifeMonths) : "",
    });
  }, [item]);

  const hasPermission =
    detailType === "components" ? isAdmin : canEdit;

  useEffect(() => {
    if (!hasPermission && editing) {
      setEditing(false);
    }
  }, [hasPermission, editing]);

  const summaryRows = [
    { key: "sku", label: "SKU / Part code", value: item.sku || "—" },
    { key: "shortCode", label: "Short code", value: item.shortCode ?? "—" },
    { key: "type", label: "Type", value: detailLabel },
    { key: "category", label: "Category", value: item.category ?? "—" },
    {
      key: "uom",
      label: "Unit of measure",
      value: item.unitOfMeasure ?? "—",
    },
    {
      key: "serialTracking",
      label: "Serial tracking",
      value: item.trackSerialNumber ? "Enabled" : "Disabled",
    },
    { key: "supplier1", label: "Supplier 1", value: item.supplier1 ?? "—" },
    { key: "supplier2", label: "Supplier 2", value: item.supplier2 ?? "—" },
    {
      key: "hubspot",
      label: "HubSpot product ID",
      value: item.hubspotProductId ?? "—",
    },
    {
      key: "xero",
      label: "Xero item code",
      value: item.xeroItemCode ?? "—",
    },
    {
      key: "subCategories",
      label: "Sub-category count",
      value: item.subCategoryIds.length
        ? String(item.subCategoryIds.length)
        : "—",
    },
    {
      key: "usefulLife",
      label: "Useful life (months)",
      value: item.usefulLifeMonths != null
        ? String(item.usefulLifeMonths)
        : "—",
    },
  ];
  if (detailType === "sensors" || detailType === "sensorExtras") {
    const cadenceLabel =
      detailType === "sensorExtras"
        ? "Annual replenishment frequency"
        : "Annual replacement frequency";
    summaryRows.push({
      key: "annualReplacementFrequency",
      label: cadenceLabel,
      value:
        item.annualReplacementFrequency != null
          ? `${formatNumber(item.annualReplacementFrequency)} / year`
          : "—",
    });
  }
  let hiddenKeys: Set<string> | null = null;
  if (detailType === "subAssemblies") {
    hiddenKeys = new Set([
      "sku",
      "supplier1",
      "supplier2",
      "hubspot",
      "xero",
      "subCategories",
    ]);
  } else if (detailType === "sensors") {
    hiddenKeys = new Set(["sku", "uom", "serialTracking", "hubspot", "subCategories"]);
  }
  const filteredRows = hiddenKeys
    ? summaryRows.filter((row) => !hiddenKeys.has(row.key))
    : summaryRows;

  const supportsEditing =
    detailType === "sensors" ||
    detailType === "subAssemblies" ||
    detailType === "components";
  const showShortCodeField =
    detailType === "sensors" || detailType === "components";
  const requireShortCode = detailType === "sensors";
  const showSupplierFields =
    detailType === "sensors" || detailType === "components";

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleCancel = () => {
    setEditing(false);
    setFormError(null);
    setForm({
      name: item.name ?? "",
      shortCode: item.shortCode ?? "",
      category: item.category ?? "",
      supplier1: item.supplier1 ?? "",
      supplier2: item.supplier2 ?? "",
      description: item.description ?? "",
      usefulLifeMonths:
        item.usefulLifeMonths != null ? String(item.usefulLifeMonths) : "",
    });
  };

  const handleSave = async () => {
    setFormError(null);
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setFormError("Name is required.");
      return;
    }
    const trimmedShort = form.shortCode.trim();
    if (requireShortCode && !trimmedShort) {
      setFormError("Short code is required.");
      return;
    }
    const usefulLifeNumber = form.usefulLifeMonths.trim()
      ? Number(form.usefulLifeMonths)
      : null;
    if (
      usefulLifeNumber != null &&
      (!Number.isFinite(usefulLifeNumber) || usefulLifeNumber < 0)
    ) {
      setFormError("Useful life must be zero or a positive number.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: trimmedName,
        shortName: trimmedName,
        category: form.category.trim() || null,
        description: form.description.trim(),
        usefulLifeMonths: usefulLifeNumber,
        updatedAt: Timestamp.now(),
      };
      if (showShortCodeField) {
        payload.shortCode = trimmedShort || null;
      }
      if (showSupplierFields) {
        payload.supplier1 = form.supplier1.trim() || null;
        payload.supplier2 = form.supplier2.trim() || null;
      }
      await updateDoc(doc(db, "items", item.id), payload);
      setEditing(false);
      onUpdated();
    } catch (err: any) {
      console.error("Error updating sensor summary", err);
      setFormError(err?.message ?? "Unable to update the sensor summary.");
    } finally {
      setSaving(false);
    }
  };

  const showEditButton = supportsEditing && hasPermission;

  return (
    <section className="ims-form-section card">
      <div className="ims-table-header">
        <div>
          <h2 className="ims-form-section-title">Item summary</h2>
          <p className="ims-form-section-subtitle">
            Master data, supplier hooks and lifecycle metadata.
          </p>
        </div>
        {showEditButton && (
          <div className="ims-page-actions" style={{ gap: "0.5rem" }}>
            {editing ? (
              <>
                <button
                  type="button"
                  className="ims-secondary-button"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ims-primary-button"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save summary"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ims-secondary-button"
                onClick={() => setEditing(true)}
              >
                Edit summary
              </button>
            )}
          </div>
        )}
      </div>
      {formError && (
        <div className="ims-alert ims-alert--error" style={{ marginBottom: "0.75rem" }}>
          {formError}
        </div>
      )}
      <div style={{ marginBottom: "0.85rem" }}>
        <div className="ims-field-label">Status</div>
        <StatusTag status={item.status} />
      </div>
      <div style={{ marginBottom: "1rem" }}>
        <div className="ims-field-label">Description</div>
        {editing ? (
          <textarea
            className="ims-field-input ims-field-textarea"
            rows={3}
            value={form.description}
            onChange={(e) => handleChange("description", e.target.value)}
          />
        ) : (
          <p style={{ margin: 0 }}>
            {item.description ? (
              item.description
            ) : (
              <span className="ims-table-empty">No description provided.</span>
            )}
          </p>
        )}
      </div>
      {editing ? (
          <div className="ims-form-stack" style={{ gap: "0.75rem" }}>
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="summaryName">
                Name
              </label>
              <input
                id="summaryName"
                className="ims-field-input"
                value={form.name}
                onChange={(e) => handleChange("name", e.target.value)}
              />
            </div>
          {showShortCodeField && (
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="summaryShortCode">
                Short code
              </label>
              <input
                id="summaryShortCode"
                className="ims-field-input"
                value={form.shortCode}
                onChange={(e) => handleChange("shortCode", e.target.value)}
              />
            </div>
          )}
          <div className="ims-field">
            <label className="ims-field-label" htmlFor="summaryCategory">
              Category
            </label>
            <input
              id="summaryCategory"
              className="ims-field-input"
              value={form.category}
              onChange={(e) => handleChange("category", e.target.value)}
            />
          </div>
          {showSupplierFields && (
            <div className="ims-field-row">
              <div className="ims-field">
                <label className="ims-field-label" htmlFor="summarySupplier1">
                  Supplier 1
                </label>
                <input
                  id="summarySupplier1"
                  className="ims-field-input"
                  value={form.supplier1}
                  onChange={(e) => handleChange("supplier1", e.target.value)}
                />
              </div>
              <div className="ims-field">
                <label className="ims-field-label" htmlFor="summarySupplier2">
                  Supplier 2
                </label>
                <input
                  id="summarySupplier2"
                  className="ims-field-input"
                  value={form.supplier2}
                  onChange={(e) => handleChange("supplier2", e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="ims-field">
            <label className="ims-field-label" htmlFor="summaryUsefulLife">
              Useful life (months)
            </label>
            <input
              id="summaryUsefulLife"
              type="number"
              min="0"
              className="ims-field-input"
              value={form.usefulLifeMonths}
              onChange={(e) => handleChange("usefulLifeMonths", e.target.value)}
            />
          </div>
        </div>
      ) : (
        <table className="ims-table ims-table--compact">
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};

const SubAssemblyStockCard = ({ item }: { item: InventoryItem }) => {
  const lifecycle = [
    { label: "Manufactured", value: item.inventoryQty },
    { label: "Work in progress", value: item.wipQty },
    { label: "Completed projects", value: item.completedQty },
  ];
  const totalUnits = lifecycle.reduce((sum, row) => sum + (row.value ?? 0), 0);
  return (
    <section className="ims-form-section card">
      <h2 className="ims-form-section-title">Assembly lifecycle</h2>
      <p className="ims-form-section-subtitle">
        Track assemblies from manufacture through active projects to completed deployments.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "0.75rem",
        }}
      >
        {lifecycle.map((row) => (
          <div key={row.label} className="card" style={{ padding: "0.65rem" }}>
            <div className="ims-metric-label">{row.label}</div>
            <div className="ims-metric-value">{formatNumber(row.value ?? 0)}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: "0.9rem" }}>
        <div className="ims-metric-label">Total assemblies</div>
        <div className="ims-metric-value">{formatNumber(totalUnits)}</div>
      </div>
    </section>
  );
};

type SubAssemblyComponentsCardProps = {
  item: InventoryItem;
  components: RelationshipEntry[];
  onUpdated: () => void;
  canEdit: boolean;
  availableComponents: ComponentOption[];
};

const SubAssemblyComponentsCard = ({
  item,
  components,
  onUpdated,
  canEdit,
  availableComponents,
}: SubAssemblyComponentsCardProps) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [draft, setDraft] = useState<
    {
      id: string;
      name: string;
      sku?: string | null;
      quantity: number;
      unitPrice?: number | null;
    }[]
  >(
    components.map((component) => ({
      id: component.id,
      name: component.name,
      sku: component.sku ?? null,
      quantity: component.quantity ?? 0,
      unitPrice: component.unitPrice ?? null,
    })),
  );

  useEffect(() => {
    setDraft(
      components.map((component) => ({
        id: component.id,
        name: component.name,
        sku: component.sku ?? null,
        quantity: component.quantity ?? 0,
        unitPrice: component.unitPrice ?? null,
      })),
    );
  }, [components]);

  useEffect(() => {
    if (!canEdit && editing) {
      setEditing(false);
    }
  }, [canEdit, editing]);

  const handleQuantityChange = (id: string, value: string) => {
    const quantity = Number(value);
    setDraft((prev) =>
      prev.map((line) =>
        line.id === id
          ? {
              ...line,
              quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : 0,
            }
          : line,
      ),
    );
  };

  const handleRemove = (id: string) => {
    setDraft((prev) => prev.filter((line) => line.id !== id));
  };

  const handleCancel = () => {
    setEditing(false);
    setFormError(null);
    setDraft(
      components.map((component) => ({
        id: component.id,
        name: component.name,
        sku: component.sku ?? null,
        quantity: component.quantity ?? 0,
        unitPrice: component.unitPrice ?? null,
      })),
    );
  };

  const handleSave = async () => {
    setFormError(null);
    const cleaned = draft
      .map((line) => ({
        componentId: line.id,
        quantity: Number(line.quantity) || 0,
        unitPrice: parseNumber(line.unitPrice) ?? 0,
      }))
      .filter((line) => line.quantity > 0);
    if (!cleaned.length) {
      setFormError("Add at least one component to define this sub-assembly.");
      return;
    }
    setSaving(true);
    try {
      const normalized = cleaned.map((line) => ({
        componentId: line.componentId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.quantity * line.unitPrice,
      }));
      const componentsTotal = normalized.reduce(
        (sum, line) => sum + line.lineTotal,
        0,
      );
      await updateDoc(doc(db, "items", item.id), {
        components: normalized,
        estimatedComponentCost: componentsTotal,
        totalCost: componentsTotal,
        updatedAt: Timestamp.now(),
      });
      setEditing(false);
      onUpdated();
    } catch (err: any) {
      console.error("Error updating sub-assembly components", err);
      setFormError(err?.message ?? "Unable to update sub-assembly components.");
    } finally {
      setSaving(false);
    }
  };

  const addableOptions = availableComponents.filter(
    (option) => !draft.some((component) => component.id === option.id),
  );

  return (
    <section className="ims-form-section card">
      <div className="ims-table-header">
        <div>
          <h2 className="ims-form-section-title">Sub-assembly components</h2>
          <p className="ims-form-section-subtitle">
            Define or adjust the component quantities that form this assembly.
          </p>
        </div>
        <div className="ims-page-actions" style={{ gap: "0.5rem" }}>
          {editing ? (
            <>
              <button
                type="button"
                className="ims-secondary-button"
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ims-primary-button"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save criteria"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ims-secondary-button"
              onClick={() => setEditing(true)}
              disabled={!canEdit}
            >
              Edit criteria
            </button>
          )}
        </div>
      </div>
      {editing && addableOptions.length > 0 && (
        <div className="ims-field" style={{ maxWidth: 360, marginBottom: "1rem" }}>
          <label className="ims-field-label" htmlFor="subAssemblyAddComponent">
            Add component
          </label>
          <select
            id="subAssemblyAddComponent"
            className="ims-field-input"
            defaultValue=""
            onChange={(e) => {
              const value = e.target.value;
              if (value) {
                const option = availableComponents.find(
                  (component) => component.id === value,
                );
                if (option) {
                  setDraft((prev) => [
                    ...prev,
                    {
                      id: option.id,
                      name: option.name,
                      sku: option.sku ?? null,
                      quantity: 1,
                      unitPrice: option.unitPrice ?? null,
                    },
                  ]);
                }
                e.target.value = "";
              }
            }}
            disabled={!canEdit}
          >
            <option value="">Select component…</option>
            {addableOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.sku ? ` (${option.sku})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      {formError && (
        <div className="ims-alert ims-alert--error" style={{ marginBottom: "0.75rem" }}>
          {formError}
        </div>
      )}
      <div className="ims-table-wrapper">
        <table className="ims-table ims-table--compact">
          <thead>
            <tr>
              <th style={{ width: "45%" }}>Component</th>
              <th>Qty</th>
              <th>Unit cost</th>
              <th>Total</th>
              {editing && <th />}
            </tr>
          </thead>
          <tbody>
            {draft.map((line) => {
              const total =
                (Number(line.unitPrice) || 0) * (Number(line.quantity) || 0);
              return (
                <tr key={line.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{line.name}</div>
                    {line.sku && (
                      <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                        {line.sku}
                      </div>
                    )}
                  </td>
                  <td>
            {editing ? (
              <input
                type="number"
                min="0"
                step="1"
                className="ims-field-input"
                value={line.quantity}
                onChange={(e) =>
                  handleQuantityChange(line.id, e.target.value)
                }
                style={{ maxWidth: "80px" }}
                disabled={!canEdit}
              />
            ) : (
              formatNumber(line.quantity)
            )}
          </td>
          <td>{formatCurrency(line.unitPrice)}</td>
          <td>{formatCurrency(total)}</td>
          {editing && (
            <td>
              <button
                type="button"
                className="ims-table-link"
                onClick={() => handleRemove(line.id)}
                disabled={!canEdit}
              >
                Remove
              </button>
            </td>
          )}
        </tr>
      );
    })}
  </tbody>
        </table>
      </div>
      {!draft.length && (
        <p className="ims-table-empty">
          No components configured for this sub-assembly yet.
        </p>
      )}
    </section>
  );
};

type ManufactureSubAssemblyCardProps = {
  item: InventoryItem;
  components: RelationshipEntry[];
  canManufacture: boolean;
  saving: boolean;
  onManufacture: (quantity: number) => Promise<void>;
};

const ManufactureSubAssemblyCard = ({
  item,
  components,
  canManufacture,
  saving,
  onManufacture,
}: Omit<ManufactureSubAssemblyCardProps, "onClose">) => {
  const [quantity, setQuantity] = useState("1");
  const [formError, setFormError] = useState<string | null>(null);
  const parsedQuantity = Number(quantity);
  const manufactureQty =
    Number.isFinite(parsedQuantity) && parsedQuantity > 0
      ? Math.floor(parsedQuantity)
      : 0;
  const rows = components
    .map((component) => {
      const perAssembly = Number(component.quantity) || 0;
      return {
        id: component.id,
        name: component.name,
        sku: component.sku ?? null,
        perAssembly,
        totalRequired: perAssembly * manufactureQty,
      };
    })
    .filter((row) => row.perAssembly > 0);

  const ready = canManufacture && manufactureQty > 0 && rows.length > 0;

  const handleSubmit = async () => {
    if (!ready) {
      setFormError("Enter a valid quantity and ensure component criteria exist.");
      return;
    }
    setFormError(null);
    await onManufacture(manufactureQty);
  };

  return (
    <section className="ims-form-section card">
      <div className="ims-table-header">
        <div>
          <h2 className="ims-form-section-title">Manufacture sub-assembly</h2>
          <p className="ims-form-section-subtitle">
            Deduct the component stock, record the movement and add the finished
            units to the manufactured bucket for this assembly.
          </p>
        </div>
      </div>
      <div className="ims-form-stack" style={{ gap: "0.75rem" }}>
        <div className="ims-field">
          <label className="ims-field-label" htmlFor="manufactureQuantity">
            Units to manufacture
          </label>
          <input
            id="manufactureQuantity"
            type="number"
            min="1"
            step="1"
            className="ims-field-input"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        {rows.length === 0 ? (
          <p className="ims-table-empty" style={{ margin: 0 }}>
            Add component criteria before manufacturing this assembly.
          </p>
        ) : (
          <div className="ims-table-wrapper">
            <table className="ims-table ims-table--compact">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Per assembly</th>
                  <th>Total for run</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{row.name}</div>
                      {row.sku && (
                        <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                          {row.sku}
                        </div>
                      )}
                    </td>
                    <td>{formatNumber(row.perAssembly)}</td>
                    <td>{formatNumber(row.totalRequired)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {formError && (
          <div
            className="ims-alert ims-alert--error"
            style={{ marginBottom: "0.5rem" }}
          >
            {formError}
          </div>
        )}
        <button
          type="button"
          className="ims-primary-button"
          onClick={handleSubmit}
          disabled={saving || !ready}
        >
          {saving ? "Manufacturing…" : "Confirm manufacture"}
        </button>
      </div>
    </section>
  );
};

type ManufactureSubAssemblyOverlayProps = {
  item: InventoryItem;
  components: RelationshipEntry[];
  canManufacture: boolean;
  saving: boolean;
  onClose: () => void;
  onManufacture: (quantity: number) => Promise<void>;
};

const ManufactureSubAssemblyOverlay = ({
  item,
  components,
  canManufacture,
  saving,
  onClose,
  onManufacture,
}: ManufactureSubAssemblyOverlayProps) => {
  const content = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(15, 23, 42, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
    >
      <div
        className="card"
        style={{
          width: "clamp(320px, 90vw, 640px)",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "1.5rem",
          position: "relative",
        }}
      >
        <button
          type="button"
          aria-label="Close manufacture overlay"
          onClick={onClose}
          className="ims-secondary-button"
          style={{
            position: "absolute",
            top: "1rem",
            right: "1rem",
            padding: "0.35rem 0.75rem",
            fontSize: "0.85rem",
          }}
          disabled={saving}
        >
          Close
        </button>
        <ManufactureSubAssemblyCard
          item={item}
          components={components}
          canManufacture={canManufacture}
          saving={saving}
          onManufacture={onManufacture}
        />
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(content, document.body);
};

export default function InventoryItemDetailPage({
  detailType,
}: {
  detailType: InventoryDetailType;
}) {
  const params = useParams<{ id: string }>();
  const rawItemId = params?.id;
  const itemId = Array.isArray(rawItemId) ? rawItemId[0] : rawItemId;
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [componentDirectory, setComponentDirectory] = useState<
    Record<
      string,
      {
        name: string;
        sku?: string | null;
        unitCost?: number | null;
      }
    >
  >({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [processingAction, setProcessingAction] = useState(false);
  const [manufacturePanelOpen, setManufacturePanelOpen] = useState(false);
  const [componentOptions, setComponentOptions] = useState<ComponentOption[]>([]);
  const [sensorExtraOptions, setSensorExtraOptions] = useState<
    SensorExtraOption[]
  >([]);
  const [purchaseStats, setPurchaseStats] = useState<{
    totalQty: number;
    draftQty: number;
    paidQty: number;
    orders: PurchaseOrderSummary[];
  } | null>(null);
  const [purchaseStatsLoading, setPurchaseStatsLoading] = useState(false);
  const [purchaseStatsError, setPurchaseStatsError] = useState<string | null>(null);
  const { canEdit, isAdmin } = useAuth();

  useEffect(() => {
    const loadItem = async () => {
      if (!itemId) {
        setError("Missing inventory identifier.");
        setItem(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const ref = doc(db, "items", itemId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setItem(null);
          setError("Item not found.");
          return;
        }
        setItem(mapItemSnapshot(snap));
      } catch (err: any) {
        console.error("Error loading inventory item", err);
        setError(err?.message ?? "Unable to load this item.");
        setItem(null);
      } finally {
        setLoading(false);
      }
    };

    loadItem();
  }, [itemId, reloadKey]);

  useEffect(() => {
    if (!item || !item.components.length) {
      setComponentDirectory({});
      return;
    }
    const uniqueIds = Array.from(
      new Set(
        item.components
          .map((component) => component.id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (!uniqueIds.length) {
      setComponentDirectory({});
      return;
    }
    let cancelled = false;
    const loadComponents = async () => {
      try {
        const records = await Promise.all(
          uniqueIds.map(async (componentId) => {
            try {
              const ref = doc(db, "items", componentId);
              const snap = await getDoc(ref);
              if (!snap.exists()) return null;
              const data = snap.data() as any;
              return {
                id: componentId,
                name: data.name ?? data.sku ?? "Unnamed component",
                sku: data.sku ?? data.shortCode ?? null,
                unitCost:
                  parseNumber(data.pricePerUnit) ?? parseNumber(data.standardCost),
              };
            } catch {
              return null;
            }
          }),
        );
        if (cancelled) return;
        const directory: Record<
          string,
          { name: string; sku?: string | null; unitCost?: number | null }
        > = {};
        records.forEach((record) => {
          if (!record) return;
          directory[record.id] = {
            name: record.name,
            sku: record.sku,
            unitCost: record.unitCost ?? null,
          };
        });
        setComponentDirectory(directory);
      } catch (err) {
        console.error("Error loading component names", err);
      }
    };

    loadComponents();

    return () => {
      cancelled = true;
    };
  }, [item]);

  useEffect(() => {
    if (detailType !== "subAssemblies") {
      setComponentOptions([]);
      return;
    }
    let cancelled = false;
    const loadComponentOptions = async () => {
      try {
        const ref = collection(db, "items");
        const snap = await getDocs(query(ref, orderBy("name")));
        if (cancelled) return;
        const options: ComponentOption[] = snap.docs
          .map((docSnap) => {
            const data = docSnap.data() as any;
            const type = normalizeItemType(
              data.itemType ?? data.rawCsvItemType ?? data.category ?? "",
            );
            if (
              type !== "component" &&
              type !== "components" &&
              type !== "component part"
            ) {
              return null;
            }
            return {
              id: docSnap.id,
              name: data.name ?? data.sku ?? "Component",
              sku: data.sku ?? data.shortCode ?? null,
              unitPrice:
                parseNumber(data.pricePerUnit) ??
                parseNumber(data.standardCost),
            };
          })
          .filter((entry): entry is ComponentOption => Boolean(entry));
        setComponentOptions(options);
      } catch (err) {
        console.error("Error loading component options", err);
      }
    };
    loadComponentOptions();
    return () => {
      cancelled = true;
    };
  }, [detailType]);

  useEffect(() => {
    if (detailType !== "sensors") {
      setSensorExtraOptions([]);
      return;
    }
    let cancelled = false;
    const loadSensorExtras = async () => {
      try {
        const ref = collection(db, "items");
        const snap = await getDocs(query(ref, orderBy("name")));
        if (cancelled) return;
        const options: SensorExtraOption[] = snap.docs
          .map((docSnap) => {
            const data = docSnap.data() as any;
            const type = normalizeItemType(
              data.itemType ?? data.rawCsvItemType ?? "",
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
              sku: data.sku ?? null,
            };
          })
          .filter((entry): entry is SensorExtraOption => Boolean(entry));
        setSensorExtraOptions(options);
      } catch (err) {
        console.error("Error loading sensor extras", err);
      }
    };
    loadSensorExtras();
    return () => {
      cancelled = true;
    };
  }, [detailType]);

  useEffect(() => {
    if (detailType !== "subAssemblies") {
      setManufacturePanelOpen(false);
    }
  }, [detailType]);

  useEffect(() => {
    if (!item?.components.length) {
      setManufacturePanelOpen(false);
    }
  }, [item?.components.length]);

  useEffect(() => {
    if (
      !item?.id ||
      (detailType !== "components" &&
        detailType !== "sensors" &&
        detailType !== "sensorExtras")
    ) {
      setPurchaseStats(null);
      setPurchaseStatsError(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setPurchaseStatsLoading(true);
      setPurchaseStatsError(null);
      try {
        const ref = collection(db, "purchases");
        const q = query(ref, where("lineItemIds", "array-contains", item.id));
        const snap = await getDocs(q);
        let totalQty = 0;
        let draftQty = 0;
        let paidQty = 0;
        const orders: PurchaseOrderSummary[] = [];

        snap.forEach((purchaseDoc) => {
          const data = purchaseDoc.data() as any;
          const lineItems = Array.isArray(data.lineItems) ? data.lineItems : [];
          const qtyForItem = lineItems.reduce((sum, line) => {
            if (line?.itemId !== item.id) return sum;
            const qty = Number(line.quantity);
            return Number.isFinite(qty) && qty > 0 ? sum + qty : sum;
          }, 0);
          if (qtyForItem <= 0) return;
          const status =
            (data.status as PurchaseStatus) ?? "draft";
          totalQty += qtyForItem;
          if (status === "draft") {
            draftQty += qtyForItem;
          } else if (status === "paid") {
            paidQty += qtyForItem;
          }
          orders.push({
            id: purchaseDoc.id,
            vendorName: data.vendorName ?? "Unknown vendor",
            reference: data.reference ?? null,
            qty: qtyForItem,
            status,
            proposedDeliveryDate: data.proposedDeliveryDate ?? null,
          });
        });

        orders.sort((a, b) => {
          const aTime = a.proposedDeliveryDate
            ? a.proposedDeliveryDate.toMillis()
            : Number.POSITIVE_INFINITY;
          const bTime = b.proposedDeliveryDate
            ? b.proposedDeliveryDate.toMillis()
            : Number.POSITIVE_INFINITY;
          return aTime - bTime;
        });

        if (!cancelled) {
          setPurchaseStats({
            totalQty,
            draftQty,
            paidQty,
            orders,
          });
        }
      } catch (err: any) {
        console.error("Error loading purchase stats", err);
        if (!cancelled) {
          setPurchaseStatsError(err?.message ?? "Unable to load purchase orders.");
          setPurchaseStats(null);
        }
      } finally {
        if (!cancelled) {
          setPurchaseStatsLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [item?.id, detailType]);

  const copy = detailCopy[detailType];
  const pageTitle = item ? `${copy.heading} · ${item.name}` : copy.heading;

  const componentsWithNames = useMemo(() => {
    if (!item) return [];
    return item.components.map((component) => {
      const override = componentDirectory[component.id];
      return override
        ? {
            ...component,
            name: override.name,
            sku: override.sku ?? component.sku,
            unitPrice:
              component.unitPrice ??
              (override.unitCost != null ? override.unitCost : component.unitPrice),
          }
        : component;
    });
  }, [item, componentDirectory]);

  const handleManufactureSubAssembly = async (units: number) => {
    if (!item || detailType !== "subAssemblies") return;
    if (!canEdit) {
      setActionError("You do not have permission to perform this action.");
      return;
    }
    if (!item.components.length) {
      setActionError("Add component criteria before manufacturing assemblies.");
      return;
    }
    if (!Number.isFinite(units) || units <= 0) {
      setActionError("Enter a valid quantity to manufacture.");
      return;
    }
    setProcessingAction(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const now = Timestamp.now();
      const manufactureId = `manufacture-${now.toMillis()}`;
      const componentLines = item.components.filter(
        (line) => line.id && (line.quantity ?? 0) > 0,
      );
      if (!componentLines.length) {
        throw new Error("Component criteria missing quantities.");
      }
      const snapshots = await Promise.all(
        componentLines.map((line) => getDoc(doc(db, "items", line.id))),
      );
      const batch = writeBatch(db);
      const summaryParts: string[] = [];
      snapshots.forEach((snap, index) => {
        const line = componentLines[index];
        if (!snap.exists()) {
          throw new Error("A component reference could not be found.");
        }
        const data = snap.data() as any;
        const componentName = data.name ?? data.sku ?? "Component";
        const currentQty =
          typeof data.inventoryQty === "number" ? data.inventoryQty : 0;
        const currentCompleted =
          typeof data.completedQty === "number" ? data.completedQty : 0;
        const perAssembly = line.quantity ?? 0;
        const totalRequired = perAssembly * units;
        if (totalRequired <= 0) return;
        const nextQty = currentQty - totalRequired;
        const nextCompleted = currentCompleted + totalRequired;
        batch.update(snap.ref, {
          inventoryQty: increment(-totalRequired),
          completedQty: increment(totalRequired),
          updatedAt: now,
          inventoryHistory: arrayUnion({
            id: `${manufactureId}-component-${snap.id}`,
            at: now,
            bucket: "Inventory → Completed",
            fromBucket: "Inventory",
            toBucket: "Completed",
            changeType: "subAssembly",
            quantity: nextCompleted,
            delta: totalRequired,
            reference: `Manufactured ${units} × ${item.name}`,
            note: `${perAssembly} per assembly`,
          }),
        });
        summaryParts.push(`${totalRequired} × ${componentName}`);
      });
      const manufacturedTotal = (item.inventoryQty ?? 0) + units;
      batch.update(doc(db, "items", item.id), {
        inventoryQty: increment(units),
        updatedAt: now,
        inventoryHistory: arrayUnion({
          id: `${manufactureId}-assembly`,
          at: now,
          bucket: "Production → Manufactured",
          fromBucket: "Production",
          toBucket: "Manufactured",
          changeType: "subAssembly",
          quantity: manufacturedTotal,
          delta: units,
          reference: "Sub-assembly manufacture",
          note: summaryParts.join(", "),
        }),
      });
      await batch.commit();
      const summaryText = summaryParts.length
        ? `Consumed ${summaryParts.join(", ")}`
        : "Manufactured without component deductions";
      setActionMessage(
        `${summaryText} to manufacture ${units} ${copy.singular.toLowerCase()}${units === 1 ? "" : "s"}.`,
      );
      setManufacturePanelOpen(false);
      setReloadKey((prev) => prev + 1);
    } catch (err: any) {
      console.error("Error manufacturing sub-assembly", err);
      setActionError(err?.message ?? "Unable to manufacture this sub-assembly.");
    } finally {
      setProcessingAction(false);
    }
  };

  const relationshipSections = useMemo(() => {
    if (!item) return [];
    if (detailType === "products") {
      return [
        {
          title: "Sub-assemblies",
          subtitle:
            "Assemblies installed in this product. Quantities reflect the units required per finished product.",
          items: item.subAssemblies,
          emptyLabel: "No sub-assemblies linked to this product.",
          fallbackType: "subAssemblies",
        },
        {
          title: "Sensors",
          subtitle:
            "Sensors bundled into the product. Mark items as mandatory to enforce them in kits.",
          items: item.sensors,
          emptyLabel: "No sensors linked to this product.",
          fallbackType: "sensors",
        },
        {
          title: "Components",
          subtitle:
            "Individual components that bypass assemblies and are installed directly in the product.",
          items: item.components,
          emptyLabel: "No loose components recorded.",
          fallbackType: "components",
        },
        {
          title: "Sensor extras",
          subtitle: "Accessories or consumables that ship with this product.",
          items: item.sensorExtras,
          emptyLabel: "No sensor extras mapped to this product.",
          fallbackType: "sensorExtras",
        },
      ];
    }
    if (detailType === "sensorExtras") {
      return [
        {
          title: "Sensors using this extra",
          subtitle:
            "Link extras back to the sensors they support to simplify picking lists.",
          items: item.sensors,
          emptyLabel: "No sensors reference this extra yet.",
          fallbackType: "sensors",
        },
      ];
    }
    return [];
  }, [detailType, item]);

  return (
    <main className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">{pageTitle}</h1>
          <p className="ims-page-subtitle">{copy.description}</p>
        </div>
        <div className="ims-page-actions">
          <Link href="/inventory" className="ims-secondary-button">
            ← Back to inventory
          </Link>
          {detailType === "subAssemblies" && (
            <button
              type="button"
              className="ims-primary-button"
              onClick={() => setManufacturePanelOpen(true)}
              disabled={
                processingAction ||
                !item ||
                !item.components.length ||
                !canEdit ||
                manufacturePanelOpen
              }
            >
              Manufacture sub-assembly
            </button>
          )}
        </div>
      </div>

      {(actionMessage || actionError) && (
        <div
          className={
            "ims-alert " +
            (actionError ? "ims-alert--error" : "ims-alert--info")
          }
          style={{ maxWidth: 640 }}
        >
          {actionError || actionMessage}
        </div>
      )}

      {error && (
        <div className="ims-alert ims-alert--error" style={{ maxWidth: 640 }}>
          {error}
        </div>
      )}

      {loading ? (
        <section className="ims-form-section card">
          <p className="ims-table-empty">Loading item details…</p>
        </section>
      ) : !item ? (
        <section className="ims-form-section card">
          <p className="ims-table-empty">
            Select a different item from the inventory list.
          </p>
        </section>
      ) : (
        <div className="ims-form-grid">
          <div className="ims-form-stack">
            <SummaryCard
              item={item}
              detailLabel={copy.singular}
              detailType={detailType}
              canEdit={canEdit}
              isAdmin={isAdmin}
              onUpdated={() => setReloadKey((prev) => prev + 1)}
            />

            {detailType === "subAssemblies" && (
              <SubAssemblyStockCard item={item} />
            )}

            {detailType === "subAssemblies" && (
              <SubAssemblyComponentsCard
                item={item}
                components={componentsWithNames}
                onUpdated={() => setReloadKey((prev) => prev + 1)}
                canEdit={canEdit}
                availableComponents={componentOptions}
              />
            )}

            {(detailType === "sensors" ||
              detailType === "sensorExtras") && (
              <SensorReplacementCard
                item={item}
                onUpdated={() => setReloadKey((prev) => prev + 1)}
                canEdit={canEdit}
                detailType={detailType}
              />
            )}

            {detailType === "sensors" && (
              <MandatorySensorExtrasCard
                item={item}
                extras={item.mandatorySensorExtras}
                options={sensorExtraOptions}
                onUpdated={() => setReloadKey((prev) => prev + 1)}
                canEdit={canEdit}
              />
            )}

            {relationshipSections.map((section) => (
              <RelationshipTable
                key={section.title}
                title={section.title}
                subtitle={section.subtitle}
                items={section.items}
                emptyLabel={section.emptyLabel}
                fallbackType={section.fallbackType}
              />
            ))}
          </div>

          <div className="ims-form-stack">
            <InventorySnapshotCard
              item={item}
              detailType={detailType}
              canEdit={canEdit}
              isAdmin={isAdmin}
              onUpdated={() => setReloadKey((prev) => prev + 1)}
            />
            {(detailType === "components" ||
              detailType === "sensors" ||
              detailType === "sensorExtras") && (
              <PurchasePipelineCard
                stats={purchaseStats}
                loading={purchaseStatsLoading}
                error={purchaseStatsError}
                itemName={item.name}
              />
            )}
            <CostingCard item={item} />
          </div>
        </div>
      )}

      {item && (
        <div style={{ marginTop: "1.5rem" }}>
          <InventoryHistoryCard item={item} />
        </div>
      )}

      {detailType === "subAssemblies" &&
        manufacturePanelOpen &&
        item &&
        componentsWithNames.length > 0 && (
          <ManufactureSubAssemblyOverlay
            item={item}
            components={componentsWithNames}
            canManufacture={
              canEdit &&
              componentsWithNames.some((component) => (component.quantity ?? 0) > 0)
            }
            saving={processingAction}
            onClose={() => setManufacturePanelOpen(false)}
            onManufacture={handleManufactureSubAssembly}
          />
        )}
    </main>
  );
}
