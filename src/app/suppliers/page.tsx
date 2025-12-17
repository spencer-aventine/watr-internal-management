"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "../_components/AuthProvider";

type Supplier = {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  paymentTerms: string;
  notes: string;
};

type SupplierFormState = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  paymentTerms: string;
  notes: string;
};

const emptyForm: SupplierFormState = {
  name: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
  paymentTerms: "",
  notes: "",
};

export default function SuppliersPage() {
  const { canEdit } = useAuth();
  const isReadOnly = !canEdit;
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<SupplierFormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === selectedId) ?? null,
    [suppliers, selectedId],
  );

  const loadSuppliers = async (preferredId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const ref = collection(db, "suppliers");
      const snap = await getDocs(query(ref, orderBy("name")));
      const rows: Supplier[] = snap.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        return {
          id: docSnap.id,
          name: data.name ?? "Unnamed supplier",
          contactName: data.contactName ?? "",
          email: data.email ?? "",
          phone: data.phone ?? "",
          address: data.address ?? "",
          paymentTerms: data.paymentTerms ?? "",
          notes: data.notes ?? "",
        };
      });
      setSuppliers(rows);
      const targetId =
        preferredId && rows.some((supplier) => supplier.id === preferredId)
          ? preferredId
          : rows.some((supplier) => supplier.id === selectedId)
            ? selectedId
            : rows[0]?.id ?? null;
      setSelectedId(targetId);
      if (!targetId) {
        setForm(emptyForm);
      }
    } catch (err: any) {
      console.error("Error loading suppliers", err);
      setError(err?.message ?? "Unable to load suppliers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, []);

  useEffect(() => {
    if (selectedSupplier) {
      setForm({
        name: selectedSupplier.name,
        contactName: selectedSupplier.contactName,
        email: selectedSupplier.email,
        phone: selectedSupplier.phone,
        address: selectedSupplier.address,
        paymentTerms: selectedSupplier.paymentTerms,
        notes: selectedSupplier.notes,
      });
    } else if (!selectedId) {
      setForm(emptyForm);
    }
  }, [selectedSupplier, selectedId]);

  const handleSelectSupplier = (supplierId: string) => {
    setSelectedId(supplierId);
  };

  const handleCreateNew = () => {
    if (isReadOnly) return;
    setSelectedId(null);
    setForm(emptyForm);
  };

  const handleChange = (field: keyof SupplierFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (isReadOnly) {
      setError("You do not have permission to edit suppliers.");
      return;
    }
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setError("Supplier name is required.");
      return;
    }
    setSaving(true);
    try {
      if (selectedId) {
        await updateDoc(doc(db, "suppliers", selectedId), {
          ...form,
          name: trimmedName,
          updatedAt: Timestamp.now(),
        });
        setMessage("Supplier updated.");
      } else {
        const ref = await addDoc(collection(db, "suppliers"), {
          ...form,
          name: trimmedName,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        setMessage("Supplier created.");
        await loadSuppliers(ref.id);
        return;
      }
      await loadSuppliers(selectedId ?? undefined);
    } catch (err: any) {
      console.error("Error saving supplier", err);
      setError(err?.message ?? "Unable to save supplier.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Suppliers</h1>
          <p className="ims-page-subtitle">
            Maintain vendor records, addresses and contact details. These suppliers
            are used across inventory items and purchase orders.
          </p>
        </div>
        <div className="ims-page-actions">
          <button
            type="button"
            className="ims-secondary-button"
            onClick={() => loadSuppliers()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="ims-primary-button"
            onClick={handleCreateNew}
            disabled={isReadOnly}
          >
            + New supplier
          </button>
        </div>
      </div>

      {isReadOnly && (
        <div className="ims-alert ims-alert--info">
          You are in view-only mode. Browse suppliers but request an elevated
          account to add or update vendor records.
        </div>
      )}

      {(error || message) && (
        <div
          className={
            "ims-alert " + (error ? "ims-alert--error" : "ims-alert--info")
          }
        >
          {error || message}
        </div>
      )}

      <div className="ims-form-grid">
        <section className="ims-form-section card">
          <h2 className="ims-form-section-title">All suppliers</h2>
          <p className="ims-form-section-subtitle">
            Select a supplier to review or edit their details.
          </p>

          {loading ? (
            <p className="ims-table-empty">Loading suppliers…</p>
          ) : suppliers.length === 0 ? (
            <p className="ims-table-empty">
              No suppliers recorded yet. Use &ldquo;New supplier&rdquo; to begin.
            </p>
          ) : (
            <ul className="ims-list">
              {suppliers.map((supplier) => (
                <li key={supplier.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectSupplier(supplier.id)}
                    className={
                      "ims-list-button" +
                      (supplier.id === selectedId
                        ? " ims-list-button--active"
                        : "")
                    }
                  >
                    <span>{supplier.name}</span>
                    <span className="ims-list-subtitle">
                      {supplier.contactName || supplier.email || supplier.phone || "No contact"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ims-form-section card">
          <h2 className="ims-form-section-title">
            {selectedId ? "Supplier details" : "Add supplier"}
          </h2>
          <p className="ims-form-section-subtitle">
            Store contact and billing details for this vendor. These values can be
            reused when raising purchase orders or attaching suppliers to inventory.
          </p>

          <form className="ims-form" onSubmit={handleSubmit}>
            <fieldset
              disabled={isReadOnly}
              style={{ border: 0, padding: 0, margin: 0 }}
            >
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="supplierName">
                Supplier name<span className="ims-required">*</span>
              </label>
              <input
                id="supplierName"
                className="ims-field-input"
                value={form.name}
                onChange={(e) => handleChange("name", e.target.value)}
                required
              />
            </div>

            <div className="ims-field-row">
              <div className="ims-field">
                <label className="ims-field-label" htmlFor="contactName">
                  Primary contact
                </label>
                <input
                  id="contactName"
                  className="ims-field-input"
                  value={form.contactName}
                  onChange={(e) => handleChange("contactName", e.target.value)}
                />
              </div>
              <div className="ims-field">
                <label className="ims-field-label" htmlFor="phone">
                  Phone
                </label>
                <input
                  id="phone"
                  className="ims-field-input"
                  value={form.phone}
                  onChange={(e) => handleChange("phone", e.target.value)}
                />
              </div>
            </div>

            <div className="ims-field">
              <label className="ims-field-label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="ims-field-input"
                value={form.email}
                onChange={(e) => handleChange("email", e.target.value)}
              />
            </div>

            <div className="ims-field">
              <label className="ims-field-label" htmlFor="address">
                Address
              </label>
              <textarea
                id="address"
                className="ims-field-input ims-field-textarea"
                rows={3}
                value={form.address}
                onChange={(e) => handleChange("address", e.target.value)}
              />
            </div>

            <div className="ims-field-row">
              <div className="ims-field">
                <label className="ims-field-label" htmlFor="paymentTerms">
                  Payment terms
                </label>
                <input
                  id="paymentTerms"
                  className="ims-field-input"
                  value={form.paymentTerms}
                  onChange={(e) => handleChange("paymentTerms", e.target.value)}
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
                onChange={(e) => handleChange("notes", e.target.value)}
              />
            </div>

            <div className="ims-form-actions">
              <button
                type="submit"
                className="ims-primary-button"
                disabled={saving || isReadOnly}
              >
                {saving
                  ? "Saving…"
                  : selectedId
                    ? "Save supplier"
                    : "Add supplier"}
              </button>
            </div>
            </fieldset>
          </form>
        </section>
      </div>
    </main>
  );
}
