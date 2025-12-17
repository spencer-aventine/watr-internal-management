"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  query,
  orderBy,
  addDoc,
  Timestamp,
  writeBatch,
  doc,
  increment,
  getDoc,
  updateDoc,
} from "firebase/firestore";

type ItemOption = {
  id: string;
  name: string;
  sku: string;
};

type SupplierOption = {
  id: string;
  name: string;
  contact?: string | null;
  address?: string | null;
};

type PurchaseLineState = {
  id: string;
  itemId: string;
  quantity: string;
  unitPrice: string;
};

type PreparedLine = {
  stateId: string;
  itemId: string;
  quantity: number;
  unitPrice: number;
  hasUnitPrice: boolean;
  sku: string;
  name: string;
  lineTotal: number;
};

type PurchaseFormState = {
  vendorName: string;
  supplierContact: string;
  supplierAddress: string;
  shipTo: string;
  deliveryFee: string;
  reference: string;
  purchaseDate: string;
  proposedDeliveryDate: string;
  notes: string;
  status: PurchaseStatus;
};

type PurchaseStatus = "draft" | "paid" | "stock_received";

const todayIso = () => new Date().toISOString().split("T")[0];
const nextWeekIso = () => {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().split("T")[0];
};

const emptyLine = (id: number): PurchaseLineState => ({
  id: `line-${id}`,
  itemId: "",
  quantity: "",
  unitPrice: "",
});

export default function PurchasingPage() {
  const [items, setItems] = useState<ItemOption[]>([]);
  const [lines, setLines] = useState<PurchaseLineState[]>([emptyLine(1)]);
  const [lineCounter, setLineCounter] = useState(1);
  const [form, setForm] = useState<PurchaseFormState>({
    vendorName: "",
    supplierContact: "",
    supplierAddress: "",
    shipTo: "",
    deliveryFee: "",
    reference: "",
    purchaseDate: todayIso(),
    proposedDeliveryDate: nextWeekIso(),
    notes: "",
    status: "draft",
  });
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierActionError, setSupplierActionError] = useState<string | null>(null);
  const [supplierActionMessage, setSupplierActionMessage] = useState<string | null>(null);
  const [loadingItems, setLoadingItems] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadItems = async () => {
      try {
        const ref = collection(db, "items");
        const q = query(ref, orderBy("name"));
        const snapshot = await getDocs(q);
        const opts: ItemOption[] = snapshot.docs.map((doc) => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            name: data.name ?? "",
            sku: data.sku ?? "",
          };
        });
        setItems(opts);
      } catch (err) {
        console.error("Error loading items", err);
        setError("Unable to load inventory for purchasing.");
      } finally {
        setLoadingItems(false);
      }
    };

    loadItems();
  }, []);


  const handleFormChange = (
    field: keyof PurchaseFormState,
    value: string,
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleLineChange = (
    lineId: string,
    field: keyof PurchaseLineState,
    value: string,
  ) => {
    setLines((prev) =>
      prev.map((line) =>
        line.id === lineId ? { ...line, [field]: value } : line,
      ),
    );
  };

  const addLine = () => {
    setLineCounter((prev) => prev + 1);
    const newId = lineCounter + 1;
    setLines((prev) => [...prev, emptyLine(newId)]);
  };

  const removeLine = (lineId: string) => {
    setLines((prev) =>
      prev.length === 1 ? prev : prev.filter((line) => line.id !== lineId),
    );
  };

  const handleSupplierSelect = (supplierId: string) => {
    setSelectedSupplierId(supplierId);
    if (!supplierId) return;
    const match = suppliers.find((supplier) => supplier.id === supplierId);
    if (!match) return;
    setForm((prev) => ({
      ...prev,
      vendorName: match.name ?? prev.vendorName,
      supplierContact: match.contact ?? "",
      supplierAddress: match.address ?? "",
    }));
  };

  const refreshSuppliers = async () => {
    try {
      const ref = collection(db, "suppliers");
      const q = query(ref, orderBy("name"));
      const snapshot = await getDocs(q);
      const opts: SupplierOption[] = snapshot.docs.map((doc) => {
        const data = doc.data() as any;
        return {
          id: doc.id,
          name: data.name ?? "Unnamed supplier",
          contact: data.contact ?? data.contactInfo ?? null,
          address: data.address ?? null,
        };
      });
      setSuppliers(opts);
    } catch (err) {
      console.error("Error refreshing suppliers", err);
    }
  };

  const handleSaveSupplier = async () => {
    setSupplierActionError(null);
    setSupplierActionMessage(null);
    if (!form.vendorName.trim()) {
      setSupplierActionError("Enter a supplier / vendor name first.");
      return;
    }
    setSupplierSaving(true);
    try {
      const now = Timestamp.now();
      const payload = {
        name: form.vendorName.trim(),
        contact: form.supplierContact.trim() || null,
        address: form.supplierAddress.trim() || null,
        updatedAt: now,
      };
      if (selectedSupplierId) {
        const ref = doc(db, "suppliers", selectedSupplierId);
        await updateDoc(ref, payload);
        setSupplierActionMessage("Supplier updated.");
      } else {
        const ref = await addDoc(collection(db, "suppliers"), {
          ...payload,
          createdAt: now,
        });
        setSelectedSupplierId(ref.id);
        setSupplierActionMessage("Supplier saved for future purchases.");
      }
      await refreshSuppliers();
    } catch (err: any) {
      console.error("Error saving supplier", err);
      setSupplierActionError(err?.message ?? "Unable to save supplier.");
    } finally {
      setSupplierSaving(false);
    }
  };

  useEffect(() => {
    const loadSuppliers = async () => {
      setLoadingSuppliers(true);
      await refreshSuppliers();
      setLoadingSuppliers(false);
    };
    loadSuppliers();
  }, []);

  const itemLookup = useMemo(() => {
    return new Map(items.map((item) => [item.id, item]));
  }, [items]);

  const preparedLines: PreparedLine[] = useMemo(() => {
    return lines.map((line) => {
      const qty = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      const hasQuantity = line.quantity.trim() !== "";
      const hasUnitPrice = line.unitPrice.trim() !== "";
      const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 0;
      const safePrice =
        hasUnitPrice && Number.isFinite(unitPrice) && unitPrice >= 0
          ? unitPrice
          : 0;
      const product = line.itemId ? itemLookup.get(line.itemId) : null;

      return {
        stateId: line.id,
        itemId: line.itemId,
        quantity: safeQty,
        unitPrice: safePrice,
        hasUnitPrice,
        sku: product?.sku ?? "",
        name: product?.name ?? "",
        lineTotal: hasQuantity && hasUnitPrice ? safeQty * safePrice : 0,
      };
    });
  }, [lines, itemLookup]);

  const validLines = preparedLines.filter(
    (line) => line.itemId && line.quantity > 0,
  );
  const orderTotal = validLines.reduce((sum, line) => {
    if (!line.hasUnitPrice) return sum;
    return sum + line.lineTotal;
  }, 0);
  const deliveryFeeInput =
    form.deliveryFee.trim() === "" ? null : Number(form.deliveryFee);
  const hasDeliveryFeeInput =
    deliveryFeeInput != null &&
    Number.isFinite(deliveryFeeInput) &&
    deliveryFeeInput >= 0;
  const deliveryFeeValue = hasDeliveryFeeInput ? deliveryFeeInput : 0;
  const grandTotal = orderTotal + deliveryFeeValue;

  const resetForm = () => {
    setForm({
      vendorName: "",
      supplierContact: "",
      supplierAddress: "",
      shipTo: "",
      deliveryFee: "",
      reference: "",
      purchaseDate: todayIso(),
      proposedDeliveryDate: nextWeekIso(),
      notes: "",
      status: "draft",
    });
    setLines([emptyLine(1)]);
    setLineCounter(1);
    setSelectedSupplierId("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!form.vendorName.trim()) {
      setError("Vendor / supplier name is required.");
      return;
    }
    if (validLines.length === 0) {
      setError("Add at least one product with a quantity to log this purchase.");
      return;
    }

    setSaving(true);

    try {
      const now = Timestamp.now();
      const purchaseDate = form.purchaseDate
        ? Timestamp.fromDate(new Date(form.purchaseDate))
        : now;
      const proposedDeliveryDate = form.proposedDeliveryDate
        ? Timestamp.fromDate(new Date(form.proposedDeliveryDate))
        : null;
      const deliveryRaw =
        form.deliveryFee.trim() === "" ? null : Number(form.deliveryFee);
      const hasDeliveryFee =
        deliveryRaw != null &&
        Number.isFinite(deliveryRaw) &&
        deliveryRaw >= 0;
      const safeDeliveryFee = hasDeliveryFee ? deliveryRaw : 0;
      const totalQuantityOrdered = validLines.reduce(
        (sum, line) => sum + line.quantity,
        0,
      );

      const linePayload = validLines.map((line) => {
        const deliveryShare =
          safeDeliveryFee > 0 && totalQuantityOrdered > 0
            ? (safeDeliveryFee * line.quantity) / totalQuantityOrdered
            : 0;
        const adjustedLineTotal = line.hasUnitPrice
          ? line.lineTotal + deliveryShare
          : null;
        const adjustedUnitPrice =
          adjustedLineTotal != null && line.quantity > 0
            ? adjustedLineTotal / line.quantity
            : null;
        return {
          itemId: line.itemId,
          sku: line.sku,
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.hasUnitPrice ? line.unitPrice : null,
          lineTotal: line.hasUnitPrice ? line.lineTotal : null,
          deliveryShare: deliveryShare > 0 ? deliveryShare : null,
          adjustedUnitPrice,
          adjustedLineTotal,
        };
      });
      const lineItemIds = Array.from(
        new Set(validLines.map((line) => line.itemId).filter(Boolean)),
      );

      const shouldUpdateStock = form.status === "stock_received";

      const purchaseRef = await addDoc(collection(db, "purchases"), {
        vendorName: form.vendorName.trim(),
        supplierContact: form.supplierContact.trim() || null,
        supplierAddress: form.supplierAddress.trim() || null,
        shipTo: form.shipTo.trim() || null,
        supplierId: selectedSupplierId || null,
        deliveryFee: hasDeliveryFee ? safeDeliveryFee : null,
        reference: form.reference.trim() || null,
        notes: form.notes.trim() || null,
        purchaseDate,
        proposedDeliveryDate,
        totalAmount:
          orderTotal + safeDeliveryFee > 0 ? orderTotal + safeDeliveryFee : null,
        lineItems: linePayload,
        lineItemIds,
        status: form.status,
        createdAt: now,
        updatedAt: now,
        createdByUserId: "system",
        stockAppliedAt: shouldUpdateStock ? now : null,
        attachments: [],
        internalNotes: [],
      });

      const quantityPerItem = new Map<
        string,
        { qty: number; sku: string }
      >();
      validLines.forEach((line) => {
        const existing = quantityPerItem.get(line.itemId);
        if (existing) {
          existing.qty += line.quantity;
          if (!existing.sku && line.sku) {
            existing.sku = line.sku;
          }
        } else {
          quantityPerItem.set(line.itemId, {
            qty: line.quantity,
            sku: line.sku,
          });
        }
      });

      const unitPlans = new Map<
        string,
        { startCounter: number; sku: string }
      >();

      await Promise.all(
        Array.from(quantityPerItem.keys()).map(async (itemId) => {
          const itemRef = doc(db, "items", itemId);
          const snap = await getDoc(itemRef);
          if (!snap.exists()) {
            throw new Error("Item not found while creating units.");
          }
          const data = snap.data() as any;
          const nextCounter =
            typeof data?.nextUnitCounter === "number" &&
            data.nextUnitCounter > 0
              ? data.nextUnitCounter
              : 1;
          const sku =
            quantityPerItem.get(itemId)?.sku ||
            data?.sku ||
            `ITEM-${itemId.slice(0, 4)}`;
          unitPlans.set(itemId, { startCounter: nextCounter, sku });
        }),
      );

      const unitsCollection = collection(db, "itemUnits");
      for (const [itemId, info] of quantityPerItem.entries()) {
        const plan = unitPlans.get(itemId);
        if (!plan) continue;
        for (let i = 0; i < info.qty; i += 1) {
          const counter = plan.startCounter + i;
          const unitCode = `${plan.sku}-${counter.toString().padStart(4, "0")}`;
          await addDoc(unitsCollection, {
            itemId,
            sku: plan.sku,
            unitCode,
            locationId: null,
            purchaseId: purchaseRef.id,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      const batch = writeBatch(db);
      quantityPerItem.forEach((info, itemId) => {
        const plan = unitPlans.get(itemId);
        const itemRef = doc(db, "items", itemId);
        batch.update(itemRef, {
          ...(shouldUpdateStock ? { inventoryQty: increment(info.qty) } : {}),
          nextUnitCounter: plan ? plan.startCounter + info.qty : info.qty,
          updatedAt: now,
        });
      });
      await batch.commit();

      setMessage(
        shouldUpdateStock
          ? "Purchase logged and stock levels updated."
          : "Purchase logged. Stock will update when marked as received.",
      );
      resetForm();
    } catch (err: any) {
      console.error("Error recording purchase", err);
      setError(err?.message ?? "Error recording purchase.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Log purchase</h1>
          <p className="ims-page-subtitle">
            Capture incoming stock, price paid and automatically bump on-hand
            inventory.
          </p>
        </div>
        <div className="ims-page-actions">
          <Link href="/purchasing/history" className="ims-secondary-button">
            View purchase history
          </Link>
          <Link
            href="/purchasing/external-po"
            className="ims-secondary-button"
          >
            Create external PO
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
        <section className="card ims-form-section">
          <h2 className="ims-form-section-title">Supplier & metadata</h2>
          <p className="ims-form-section-subtitle">
            Who you bought from, when the order was placed and any references.
          </p>

          <div className="ims-field">
            <label className="ims-field-label" htmlFor="savedSupplier">
              Saved supplier
            </label>
            <select
              id="savedSupplier"
              className="ims-field-input"
              value={selectedSupplierId}
              onChange={(e) => handleSupplierSelect(e.target.value)}
              disabled={loadingSuppliers}
            >
              <option value="">
                {loadingSuppliers
                  ? "Loading suppliers…"
                  : "Select saved supplier…"}
              </option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            <p className="ims-field-help">
              Selecting a saved supplier fills the fields below. Update any
              details and click “Save supplier” to keep them in sync.
            </p>
          </div>

          <div className="ims-field">
            <label className="ims-field-label" htmlFor="vendorName">
              Vendor / supplier<span className="ims-required">*</span>
            </label>
            <input
              id="vendorName"
              type="text"
              className="ims-field-input"
              value={form.vendorName}
              onChange={(e) => handleFormChange("vendorName", e.target.value)}
              placeholder="e.g. Ocean Components Ltd"
            />
          </div>

          <div className="ims-field">
            <label className="ims-field-label" htmlFor="supplierContact">
              Supplier contact info
            </label>
            <input
              id="supplierContact"
              type="text"
              className="ims-field-input"
              value={form.supplierContact}
              onChange={(e) =>
                handleFormChange("supplierContact", e.target.value)
              }
              placeholder="Email, phone or account manager"
            />
          </div>

          <div className="ims-field">
            <label className="ims-field-label" htmlFor="supplierAddress">
              Supplier address
            </label>
            <textarea
              id="supplierAddress"
              className="ims-field-input ims-field-textarea"
              rows={3}
              value={form.supplierAddress}
              onChange={(e) =>
                handleFormChange("supplierAddress", e.target.value)
              }
              placeholder={"Supplier address\nCity\nPostcode"}
            />
          </div>

          <div className="ims-field">
            <label className="ims-field-label" htmlFor="shipTo">
              Ship to / delivery location
            </label>
            <textarea
              id="shipTo"
              className="ims-field-input ims-field-textarea"
              rows={2}
              value={form.shipTo}
              onChange={(e) => handleFormChange("shipTo", e.target.value)}
              placeholder={"Warehouse name\nAddress"}
            />
          </div>

          <div className="ims-field">
            <label className="ims-field-label" htmlFor="deliveryFee">
              Delivery / freight cost (£)
            </label>
            <input
              id="deliveryFee"
              type="number"
              min="0"
              step="0.01"
              className="ims-field-input"
              value={form.deliveryFee}
              onChange={(e) => handleFormChange("deliveryFee", e.target.value)}
              placeholder="0.00"
            />
            <p className="ims-field-help">
              We’ll spread this cost across each line item to give a landed unit
              price.
            </p>
          </div>

          <div className="ims-field">
            <button
              type="button"
              className="ims-secondary-button"
              onClick={handleSaveSupplier}
              disabled={supplierSaving}
            >
              {supplierSaving
                ? "Saving supplier…"
                : selectedSupplierId
                  ? "Update saved supplier"
                  : "Save supplier for reuse"}
            </button>
            {supplierActionError && (
              <p className="ims-field-help" style={{ color: "#b91c1c" }}>
                {supplierActionError}
              </p>
            )}
            {supplierActionMessage && (
              <p className="ims-field-help" style={{ color: "#065f46" }}>
                {supplierActionMessage}
              </p>
            )}
          </div>

          <div className="ims-field-row">
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="reference">
                PO / reference
              </label>
              <input
                id="reference"
                type="text"
                className="ims-field-input"
                value={form.reference}
                onChange={(e) => handleFormChange("reference", e.target.value)}
                placeholder="PO-001245"
              />
            </div>
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="purchaseDate">
                Purchase date
              </label>
              <input
                id="purchaseDate"
                type="date"
                className="ims-field-input"
                value={form.purchaseDate}
                onChange={(e) =>
                  handleFormChange("purchaseDate", e.target.value)
                }
              />
            </div>
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="proposedDeliveryDate">
                Proposed delivery
              </label>
              <input
                id="proposedDeliveryDate"
                type="date"
                className="ims-field-input"
                value={form.proposedDeliveryDate}
                onChange={(e) =>
                  handleFormChange("proposedDeliveryDate", e.target.value)
                }
              />
            </div>
          </div>

          <div className="ims-field">
            <label className="ims-field-label" htmlFor="notes">
              Notes
            </label>
            <textarea
              id="notes"
              className="ims-field-input ims-field-textarea"
              rows={3}
              value={form.notes}
              onChange={(e) => handleFormChange("notes", e.target.value)}
              placeholder="Any delivery notes or invoice IDs…"
            />
          </div>

          <div className="ims-field" style={{ maxWidth: "220px" }}>
            <label className="ims-field-label" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              className="ims-field-input"
              value={form.status}
              onChange={(e) =>
                handleFormChange("status", e.target.value as PurchaseStatus)
              }
            >
              <option value="draft">Draft</option>
              <option value="paid">Paid</option>
              <option value="stock_received">Stock received</option>
            </select>
            <p className="ims-field-help">
              Inventory updates automatically when status is “Stock received”.
            </p>
          </div>
        </section>

        <section className="card ims-form-section">
          <div className="ims-table-header" style={{ marginBottom: "1rem" }}>
            <div>
              <h2 className="ims-form-section-title">What did you buy?</h2>
              <p className="ims-form-section-subtitle">
                Select one or more inventory items, enter the received quantity
                and the price paid per unit.
              </p>
            </div>
            <div>
              <button
                type="button"
                className="ims-secondary-button"
                onClick={addLine}
              >
                + Add line
              </button>
            </div>
          </div>

          <div className="ims-table-wrapper">
            <table className="ims-table">
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>Product</th>
                  <th>Qty</th>
                      <th>Unit price (£)</th>
                  <th>Total (£)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const computed = preparedLines.find(
                    (l) => l.stateId === line.id,
                  );
                  return (
                    <tr key={line.id}>
                      <td>
                        <select
                          className="ims-field-input"
                          value={line.itemId}
                          disabled={loadingItems}
                          onChange={(e) =>
                            handleLineChange(line.id, "itemId", e.target.value)
                          }
                        >
                          <option value="">
                            {loadingItems
                              ? "Loading items…"
                              : "Select a product…"}
                          </option>
                          {items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.sku})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          className="ims-field-input"
                          value={line.quantity}
                          onChange={(e) =>
                            handleLineChange(line.id, "quantity", e.target.value)
                          }
                          placeholder="0"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="ims-field-input"
                          value={line.unitPrice}
                          onChange={(e) =>
                            handleLineChange(
                              line.id,
                              "unitPrice",
                              e.target.value,
                            )
                          }
                          placeholder="0.00"
                        />
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {computed && computed.hasUnitPrice
                          ? `£${computed.lineTotal.toFixed(2)}`
                          : "–"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ims-icon-button"
                          onClick={() => removeLine(line.id)}
                          aria-label="Remove line"
                          disabled={lines.length === 1}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: "1rem",
            }}
          >
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 500, color: "#475569" }}>
                Items total:{" "}
                <strong style={{ color: "#0f172a" }}>
                  £{orderTotal.toFixed(2)}
                </strong>
              </div>
              <div style={{ fontWeight: 500, color: "#475569" }}>
                Delivery:{" "}
                <strong style={{ color: "#0f172a" }}>
                  {hasDeliveryFeeInput
                    ? `£${deliveryFeeValue.toFixed(2)}`
                    : "—"}
                </strong>
              </div>
              <div style={{ fontWeight: 600, fontSize: "1.1rem" }}>
                Order total: £{grandTotal.toFixed(2)}
              </div>
            </div>
          </div>
        </section>

        <div className="ims-form-actions">
          <button
            type="submit"
            className="ims-primary-button"
            disabled={saving}
          >
            {saving ? "Saving…" : "Log purchase & update stock"}
          </button>
        </div>
      </form>
    </main>
  );
}
