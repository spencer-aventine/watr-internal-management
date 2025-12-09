"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

type PoFormState = {
  issuerName: string;
  issuerAddress: string;
  issuerContact: string;
  poNumber: string;
  issueDate: string;
  supplierName: string;
  supplierContact: string;
  supplierAddress: string;
  shipTo: string;
  notes: string;
};

type PoLineState = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

type PreparedLine = {
  stateId: string;
  description: string;
  quantity: number;
  hasQuantity: boolean;
  unitPrice: number;
  hasUnitPrice: boolean;
  lineTotal: number;
};

const todayIso = () => new Date().toISOString().split("T")[0];

const defaultPoNumber = () => {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  return `PO-${stamp}`;
};

const emptyLine = (id: number): PoLineState => ({
  id: `line-${id}`,
  description: "",
  quantity: "",
  unitPrice: "",
});

const getFirstLine = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.split(/\n/)[0];
};

const MultilineText = ({
  value,
  placeholder = "—",
}: {
  value: string;
  placeholder?: string;
}) => {
  if (!value.trim()) {
    return <span className="po-muted">{placeholder}</span>;
  }
  const segments = value.split(/\n/);
  return (
    <>
      {segments.map((segment, index) => (
        <span key={`${segment}-${index}`}>
          {segment}
          {index < segments.length - 1 && <br />}
        </span>
      ))}
    </>
  );
};

export default function ExternalPurchaseOrderPage() {
  const searchParams = useSearchParams();
  const purchaseId = searchParams.get("purchaseId");
  const [form, setForm] = useState<PoFormState>({
    issuerName: "WATR Limited",
    issuerAddress: "",
    issuerContact: "",
    poNumber: defaultPoNumber(),
    issueDate: todayIso(),
    supplierName: "",
    supplierContact: "",
    supplierAddress: "",
    shipTo: "",
    notes: "",
  });
  const [lines, setLines] = useState<PoLineState[]>([emptyLine(1)]);
  const [lineCounter, setLineCounter] = useState(1);
  const [loadingPurchase, setLoadingPurchase] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [linkedPurchase, setLinkedPurchase] = useState<{
    id: string;
    vendorName: string;
  } | null>(null);

  const handleFormChange = (field: keyof PoFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleLineChange = (
    id: string,
    field: keyof PoLineState,
    value: string,
  ) => {
    setLines((prev) =>
      prev.map((line) =>
        line.id === id ? { ...line, [field]: value } : line,
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

  const preparedLines = useMemo<PreparedLine[]>(() => {
    return lines.map((line) => {
      const qty = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      const hasQuantity = line.quantity.trim() !== "" && Number.isFinite(qty);
      const hasUnitPrice =
        line.unitPrice.trim() !== "" && Number.isFinite(unitPrice);
      const safeQty = hasQuantity && qty > 0 ? qty : 0;
      const safePrice = hasUnitPrice && unitPrice >= 0 ? unitPrice : 0;
      return {
        stateId: line.id,
        description: line.description,
        quantity: safeQty,
        hasQuantity,
        unitPrice: safePrice,
        hasUnitPrice,
        lineTotal:
          hasQuantity && hasUnitPrice ? parseFloat((safeQty * safePrice).toFixed(2)) : 0,
      };
    });
  }, [lines]);

  const orderTotal = useMemo(() => {
    return preparedLines.reduce((sum, line) => sum + line.lineTotal, 0);
  }, [preparedLines]);

  const handlePrint = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(value);

  useEffect(() => {
    const loadPurchase = async () => {
      if (!purchaseId) {
        setLinkedPurchase(null);
        setPurchaseError(null);
        return;
      }
      setLoadingPurchase(true);
      setPurchaseError(null);
      try {
        const ref = doc(db, "purchases", purchaseId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setPurchaseError("Purchase not found.");
          setLinkedPurchase(null);
          setLines([emptyLine(1)]);
          setLineCounter(1);
          return;
        }
        const data = snap.data() as any;
        setLinkedPurchase({
          id: snap.id,
          vendorName: data.vendorName ?? "Purchase",
        });
        setForm((prev) => ({
          ...prev,
          supplierName: data.vendorName ?? prev.supplierName,
          supplierContact: data.supplierContact ?? prev.supplierContact,
          supplierAddress: data.supplierAddress ?? prev.supplierAddress,
          shipTo: data.shipTo ?? prev.shipTo,
          poNumber: data.reference ?? prev.poNumber,
          notes: data.notes ?? prev.notes,
        }));
        if (Array.isArray(data.lineItems) && data.lineItems.length > 0) {
          const mapped = data.lineItems.map((line: any, index: number) => ({
            id: `line-${index + 1}`,
            description:
              line.name ??
              line.sku ??
              (line.itemId ? `Item ${line.itemId}` : `Line ${index + 1}`),
            quantity:
              typeof line.quantity === "number" && line.quantity > 0
                ? String(line.quantity)
                : "",
            unitPrice:
              typeof line.unitPrice === "number"
                ? line.unitPrice.toFixed(2)
                : "",
          }));
          setLines(mapped);
          setLineCounter(mapped.length);
        } else {
          setLines([emptyLine(1)]);
          setLineCounter(1);
        }
      } catch (err) {
        console.error("Error loading purchase for external PO", err);
        setPurchaseError("Unable to load purchase details.");
        setLinkedPurchase(null);
      } finally {
        setLoadingPurchase(false);
      }
    };

    loadPurchase();
  }, [purchaseId]);

  return (
    <>
      <main className="ims-content external-po-page">
        <div className="ims-page-header ims-page-header--with-actions print-hidden">
          <div>
            <h1 className="ims-page-title">External purchase order</h1>
            <p className="ims-page-subtitle">
              Generate a shareable PO that summarises what you are buying,
              supplier details and the purchase reference.
            </p>
          </div>
          <div className="ims-page-actions">
            <button
              type="button"
              className="ims-secondary-button"
              onClick={handlePrint}
            >
              Print / save PDF
            </button>
          </div>
        </div>

        {purchaseId && (
          <div
            className={
              "ims-alert print-hidden " +
              (purchaseError ? "ims-alert--error" : "ims-alert--info")
            }
            style={{ marginBottom: "1rem" }}
          >
            {loadingPurchase
              ? "Loading purchase details…"
              : purchaseError
                ? purchaseError
                : linkedPurchase
                  ? (
                      <>
                        Prefilled from purchase{" "}
                        <Link
                          href={`/purchasing/${linkedPurchase.id}`}
                          className="ims-table-link"
                        >
                          {linkedPurchase.vendorName}
                        </Link>
                        . You can still edit any fields before printing.
                      </>
                    )
                  : "Purchase details applied."}
          </div>
        )}

        <div className="external-po-layout">
          <div className="external-po-controls print-hidden">
            <section className="card ims-form-section">
              <h2 className="ims-form-section-title">Details & supplier</h2>
              <p className="ims-form-section-subtitle">
                These fields feed directly into the printable purchase order.
              </p>
              <div className="ims-field">
                <label className="ims-field-label" htmlFor="issuerName">
                  Your company name
                </label>
                <input
                  id="issuerName"
                  className="ims-field-input"
                  value={form.issuerName}
                  onChange={(e) =>
                    handleFormChange("issuerName", e.target.value)
                  }
                  placeholder="WATR Limited"
                />
              </div>
              <div className="ims-field">
                <label className="ims-field-label" htmlFor="issuerAddress">
                  Your address
                </label>
                <textarea
                  id="issuerAddress"
                  className="ims-field-input ims-field-textarea"
                  rows={3}
                  value={form.issuerAddress}
                  onChange={(e) =>
                    handleFormChange("issuerAddress", e.target.value)
                  }
                  placeholder={"123 Sample Street\nLondon\nSW1A 1AA"}
                />
              </div>
              <div className="ims-field">
                <label className="ims-field-label" htmlFor="issuerContact">
                  Contact details
                </label>
                <input
                  id="issuerContact"
                  className="ims-field-input"
                  value={form.issuerContact}
                  onChange={(e) =>
                    handleFormChange("issuerContact", e.target.value)
                  }
                  placeholder="procurement@company.com · +44 1234 123456"
                />
              </div>

              <div className="ims-field-row">
                <div className="ims-field">
                  <label className="ims-field-label" htmlFor="poNumber">
                    PO number
                  </label>
                  <input
                    id="poNumber"
                    className="ims-field-input"
                    value={form.poNumber}
                    onChange={(e) =>
                      handleFormChange("poNumber", e.target.value)
                    }
                    placeholder="PO-0001"
                  />
                </div>
                <div className="ims-field">
                  <label className="ims-field-label" htmlFor="issueDate">
                    Issue date
                  </label>
                  <input
                    id="issueDate"
                    type="date"
                    className="ims-field-input"
                    value={form.issueDate}
                    onChange={(e) =>
                      handleFormChange("issueDate", e.target.value)
                    }
                  />
                </div>
              </div>

              <div className="ims-field">
                <label className="ims-field-label" htmlFor="supplierName">
                  Supplier
                </label>
                <input
                  id="supplierName"
                  className="ims-field-input"
                  value={form.supplierName}
                  onChange={(e) =>
                    handleFormChange("supplierName", e.target.value)
                  }
                  placeholder="Supplier company name"
                />
              </div>

              <div className="ims-field">
                <label className="ims-field-label" htmlFor="supplierContact">
                  Supplier contact
                </label>
                <input
                  id="supplierContact"
                  className="ims-field-input"
                  value={form.supplierContact}
                  onChange={(e) =>
                    handleFormChange("supplierContact", e.target.value)
                  }
                  placeholder="contact@supplier.com · +44 20 123 456"
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
                  placeholder={"Supplier HQ\nCity\nPost code"}
                />
              </div>

              <div className="ims-field">
                <label className="ims-field-label" htmlFor="shipTo">
                  Ship to / delivery location
                </label>
                <textarea
                  id="shipTo"
                  className="ims-field-input ims-field-textarea"
                  rows={3}
                  value={form.shipTo}
                  onChange={(e) => handleFormChange("shipTo", e.target.value)}
                  placeholder={"Warehouse name\nSite address\nAny reference"}
                />
              </div>

              <div className="ims-field">
                <label className="ims-field-label" htmlFor="notes">
                  Footer notes
                </label>
                <textarea
                  id="notes"
                  className="ims-field-input ims-field-textarea"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => handleFormChange("notes", e.target.value)}
                  placeholder="Payment terms, delivery guidance or attachments."
                />
              </div>
            </section>

            <section className="card ims-form-section">
              <div className="ims-table-header" style={{ marginBottom: "1rem" }}>
                <div>
                  <h2 className="ims-form-section-title">Line items</h2>
                  <p className="ims-form-section-subtitle">
                    Include each product or service and the quantity requested.
                  </p>
                </div>
                <div>
                  <button
                    type="button"
                    className="ims-secondary-button"
                    onClick={addLine}
                  >
                    + Add row
                  </button>
                </div>
              </div>

              <div className="ims-table-wrapper">
                <table className="ims-table">
                  <thead>
                    <tr>
                      <th style={{ width: "45%" }}>Description</th>
                      <th>Qty</th>
                      <th>Unit price (£)</th>
                      <th>Total (£)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => {
                      const computed = preparedLines.find(
                        (prepared) => prepared.stateId === line.id,
                      );
                      return (
                        <tr key={line.id}>
                          <td>
                            <input
                              className="ims-field-input"
                              value={line.description}
                              onChange={(e) =>
                                handleLineChange(
                                  line.id,
                                  "description",
                                  e.target.value,
                                )
                              }
                              placeholder="Product or service"
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              className="ims-field-input"
                              value={line.quantity}
                              onChange={(e) =>
                                handleLineChange(
                                  line.id,
                                  "quantity",
                                  e.target.value,
                                )
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
                            {computed && computed.hasQuantity && computed.hasUnitPrice
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
            </section>
          </div>

          <section className="external-po-preview">
            <div className="po-document">
              <div className="po-document__header">
                <div>
                  <p className="po-label">Issued by</p>
                  <h2 className="po-company">
                    {form.issuerName || "Add your company"}
                  </h2>
                  <p className="po-address">
                    <MultilineText
                      value={form.issuerAddress}
                      placeholder="Add your address"
                    />
                  </p>
                  <p className="po-muted">{form.issuerContact || "Add contact details"}</p>
                </div>
                <div className="po-meta">
                  <div>
                    <span>PO number</span>
                    <strong>{form.poNumber || "—"}</strong>
                  </div>
                  <div>
                    <span>Issue date</span>
                    <strong>
                      {form.issueDate
                        ? new Date(form.issueDate).toLocaleDateString("en-GB", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="po-party-grid">
                <div className="po-card">
                  <p className="po-label">Supplier</p>
                  <p className="po-card-title">
                    {form.supplierName || "Add supplier name"}
                  </p>
                  <p className="po-muted">{form.supplierContact || "Add supplier contact"}</p>
                  <p>
                    <MultilineText
                      value={form.supplierAddress}
                      placeholder="Supplier address"
                    />
                  </p>
                </div>
                <div className="po-card">
                  <p className="po-label">Ship / deliver to</p>
                  <p className="po-card-title">
                    {getFirstLine(form.shipTo) || "Add delivery details"}
                  </p>
                  <p>
                    <MultilineText
                      value={form.shipTo}
                      placeholder="Delivery location"
                    />
                  </p>
                </div>
              </div>

              <table className="po-items-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {preparedLines.map((line) => (
                    <tr key={line.stateId}>
                      <td>{line.description || "—"}</td>
                      <td>{line.hasQuantity ? line.quantity : "—"}</td>
                      <td>
                        {line.hasUnitPrice
                          ? formatCurrency(line.unitPrice)
                          : "—"}
                      </td>
                      <td>
                        {line.hasQuantity && line.hasUnitPrice
                          ? formatCurrency(line.lineTotal)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="po-total">
                <span>Order total</span>
                <strong>{formatCurrency(orderTotal)}</strong>
              </div>

              <div className="po-notes">
                <p className="po-label">Notes & terms</p>
                <p>
                  {form.notes.trim() ? (
                    <MultilineText value={form.notes} />
                  ) : (
                    <span className="po-muted">
                      Include payment terms, delivery instructions or anything
                      else the supplier needs to know.
                    </span>
                  )}
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      <style jsx>{`
        .external-po-page {
          gap: 1.5rem;
        }
        .external-po-layout {
          display: grid;
          grid-template-columns: minmax(0, 420px) minmax(0, 1fr);
          gap: 1.5rem;
          align-items: flex-start;
        }
        .external-po-controls {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .external-po-preview {
          width: 100%;
        }
        .po-document {
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 30px 70px rgba(15, 23, 42, 0.08);
          padding: 2.5rem;
          color: #0f172a;
          max-width: 920px;
          margin: 0 auto;
          position: relative;
        }
        .po-document__header {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 1.5rem;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 1.5rem;
          margin-bottom: 1.5rem;
        }
        .po-company {
          font-size: 1.5rem;
          margin: 0.25rem 0;
        }
        .po-address {
          white-space: pre-line;
          margin: 0;
        }
        .po-label {
          text-transform: uppercase;
          font-size: 0.75rem;
          letter-spacing: 0.12em;
          color: #64748b;
          margin-bottom: 0.25rem;
        }
        .po-meta {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0.75rem;
          text-align: right;
        }
        .po-meta span {
          display: block;
          font-size: 0.75rem;
          letter-spacing: 0.08em;
          color: #94a3b8;
          text-transform: uppercase;
        }
        .po-meta strong {
          font-size: 1.1rem;
        }
        .po-muted {
          color: #94a3b8;
        }
        .po-party-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 1.25rem;
          margin-bottom: 1.5rem;
        }
        .po-card {
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 1rem 1.25rem;
        }
        .po-card-title {
          font-size: 1.05rem;
          font-weight: 600;
          margin-bottom: 0.35rem;
        }
        .po-items-table {
          width: 100%;
          border-collapse: collapse;
        }
        .po-items-table th {
          text-align: left;
          font-size: 0.75rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #94a3b8;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 0.35rem;
        }
        .po-items-table td {
          padding: 0.85rem 0;
          border-bottom: 1px solid #f1f5f9;
        }
        .po-items-table td:nth-child(2),
        .po-items-table td:nth-child(3),
        .po-items-table td:nth-child(4),
        .po-items-table th:nth-child(2),
        .po-items-table th:nth-child(3),
        .po-items-table th:nth-child(4) {
          text-align: right;
        }
        .po-total {
          display: flex;
          justify-content: flex-end;
          gap: 1rem;
          align-items: center;
          margin-top: 1.25rem;
          font-size: 1.25rem;
          font-weight: 600;
        }
        .po-notes {
          margin-top: 2rem;
          border-top: 1px dashed #cbd5f5;
          padding-top: 1rem;
        }
        @media (max-width: 1100px) {
          .external-po-layout {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <style jsx global>{`
        @media print {
          .print-hidden {
            display: none !important;
          }
          body {
            background: #fff !important;
          }
          .po-document {
            box-shadow: none !important;
            border-radius: 0;
            margin: 0;
            max-width: none;
            width: 100%;
            padding: 1in;
          }
        }
      `}</style>
    </>
  );
}
