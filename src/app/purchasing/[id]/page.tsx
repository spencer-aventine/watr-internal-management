"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  doc,
  getDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  increment,
} from "firebase/firestore";

type PurchaseLine = {
  itemId?: string | null;
  sku?: string | null;
  name?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
};

type PurchaseAttachment = {
  id: string;
  name: string;
  size: number;
  type?: string | null;
  dataUrl: string;
  uploadedAt?: Timestamp | null;
};

type PurchaseNote = {
  id: string;
  body: string;
  createdAt?: Timestamp | null;
};

type PurchaseRecord = {
  id: string;
  vendorName: string;
  reference?: string | null;
  purchaseDate?: Timestamp | null;
  totalAmount?: number | null;
  notes?: string | null;
  createdAt?: Timestamp | null;
  lineItems: PurchaseLine[];
  status: PurchaseStatus;
  stockAppliedAt?: Timestamp | null;
  attachments: PurchaseAttachment[];
  internalNotes: PurchaseNote[];
};

type PurchaseStatus = "draft" | "paid" | "stock_received";

const statusThemes: Record<
  PurchaseStatus,
  { label: string; bg: string; color: string; border: string }
> = {
  draft: {
    label: "Draft",
    bg: "#fef3c7",
    color: "#92400e",
    border: "#fcd34d",
  },
  paid: {
    label: "Paid",
    bg: "#dbeafe",
    color: "#1d4ed8",
    border: "#93c5fd",
  },
  stock_received: {
    label: "Stock received",
    bg: "#dcfce7",
    color: "#166534",
    border: "#86efac",
  },
};

const formatCurrency = (value?: number | null) => {
  if (value == null || Number.isNaN(value)) return "—";
  return `£${value.toFixed(2)}`;
};

const formatDate = (timestamp?: Timestamp | null) => {
  if (!timestamp) return "—";
  try {
    return timestamp.toDate().toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
};

const readFileAsDataUrl = (file: File) => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
};

export default function PurchaseDetailPage() {
  const params = useParams<{ id: string }>();
  const purchaseId = params?.id;

  const [purchase, setPurchase] = useState<PurchaseRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lineDrafts, setLineDrafts] = useState<string[]>([]);
  const [lineSaving, setLineSaving] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);
  const [lineMessage, setLineMessage] = useState<string | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!purchaseId) return;
      setLoading(true);
      setError(null);
      try {
        const ref = doc(db, "purchases", purchaseId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setError("Purchase not found.");
          setPurchase(null);
          setLoading(false);
          return;
        }
        const data = snap.data() as any;
        setPurchase({
          id: snap.id,
          vendorName: data.vendorName ?? "Unknown vendor",
          reference: data.reference ?? null,
          purchaseDate: data.purchaseDate ?? data.createdAt ?? null,
          totalAmount:
            typeof data.totalAmount === "number" ? data.totalAmount : null,
          notes: data.notes ?? null,
          createdAt: data.createdAt ?? null,
          lineItems: Array.isArray(data.lineItems) ? data.lineItems : [],
          status: (data.status as PurchaseStatus) ?? "draft",
          stockAppliedAt: data.stockAppliedAt ?? null,
          attachments: Array.isArray(data.attachments)
            ? data.attachments
            : [],
          internalNotes: Array.isArray(data.internalNotes)
            ? data.internalNotes
            : [],
        });
      } catch (err) {
        console.error("Error loading purchase", err);
        setError("Unable to load this purchase.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [purchaseId]);

  useEffect(() => {
    if (purchase?.lineItems) {
      setLineDrafts(
        purchase.lineItems.map((line) =>
          typeof line.quantity === "number" ? String(line.quantity) : "",
        ),
      );
    } else {
      setLineDrafts([]);
    }
  }, [purchase]);

  const statusTheme = useMemo(() => {
    if (!purchase) return statusThemes.draft;
    return statusThemes[purchase.status];
  }, [purchase]);

  const applyInventoryFromPurchase = async (
    lines: PurchaseLine[],
    timestamp: Timestamp,
  ) => {
    const quantityMap = new Map<string, number>();
    lines.forEach((line) => {
      if (!line.itemId) return;
      const qty =
        typeof line.quantity === "number" && line.quantity > 0
          ? line.quantity
          : null;
      if (!qty) return;
      quantityMap.set(line.itemId, (quantityMap.get(line.itemId) ?? 0) + qty);
    });
    if (quantityMap.size === 0) return;
    const batch = writeBatch(db);
    quantityMap.forEach((qty, itemId) => {
      const itemRef = doc(db, "items", itemId);
      batch.update(itemRef, {
        inventoryQty: increment(qty),
        updatedAt: timestamp,
      });
    });
    await batch.commit();
  };

  const handleStatusChange = async (nextStatus: PurchaseStatus) => {
    if (!purchase || nextStatus === purchase.status) return;
    setStatusUpdating(true);
    setStatusError(null);
    setStatusMessage(null);
    const now = Timestamp.now();
    const shouldApplyInventory =
      nextStatus === "stock_received" && !purchase.stockAppliedAt;

    try {
      if (shouldApplyInventory) {
        await applyInventoryFromPurchase(purchase.lineItems, now);
      }

      await updateDoc(doc(db, "purchases", purchase.id), {
        status: nextStatus,
        updatedAt: now,
        ...(shouldApplyInventory ? { stockAppliedAt: now } : {}),
      });

      setPurchase((prev) =>
        prev
          ? {
              ...prev,
              status: nextStatus,
              stockAppliedAt: shouldApplyInventory ? now : prev.stockAppliedAt,
            }
          : prev,
      );
      setStatusMessage(
        shouldApplyInventory
          ? "Status updated and stock added."
          : "Status updated.",
      );
    } catch (err: any) {
      console.error("Error updating purchase status", err);
      setStatusError(err?.message ?? "Unable to update status.");
    } finally {
      setStatusUpdating(false);
    }
  };

  const canEditStockCounts = purchase?.status === "stock_received";

  const lineChangesPending = useMemo(() => {
    if (!purchase || purchase.lineItems.length === 0) return false;
    if (purchase.lineItems.length !== lineDrafts.length) {
      return true;
    }
    return purchase.lineItems.some((line, idx) => {
      const base =
        typeof line.quantity === "number" ? String(line.quantity) : "";
      const draft = lineDrafts[idx] ?? base;
      return draft !== base;
    });
  }, [purchase, lineDrafts]);

  const handleLineDraftChange = (index: number, value: string) => {
    setLineError(null);
    setLineMessage(null);
    setLineDrafts((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleSaveLineCounts = async () => {
    if (!purchase || !canEditStockCounts || !purchase.lineItems.length) {
      return;
    }
    setLineSaving(true);
    setLineError(null);
    setLineMessage(null);

    const updatedLines: PurchaseLine[] = [];
    for (let idx = 0; idx < purchase.lineItems.length; idx += 1) {
      const line = purchase.lineItems[idx];
      const raw = lineDrafts[idx] ?? "";
      if (raw.trim() === "") {
        setLineError("Enter a quantity for every line item.");
        setLineSaving(false);
        return;
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setLineError("Stock counts must be numbers zero or above.");
        setLineSaving(false);
        return;
      }
      const quantity = parsed;
      const hasUnitPrice = typeof line.unitPrice === "number";
      updatedLines.push({
        ...line,
        quantity,
        lineTotal:
          hasUnitPrice && quantity != null
            ? (line.unitPrice as number) * quantity
            : line.lineTotal ?? null,
      });
    }

    try {
      await updateDoc(doc(db, "purchases", purchase.id), {
        lineItems: updatedLines,
        updatedAt: Timestamp.now(),
      });
      setPurchase((prev) =>
        prev ? { ...prev, lineItems: updatedLines } : prev,
      );
      setLineMessage("Stock counts saved.");
    } catch (err: any) {
      console.error("Error updating stock counts", err);
      setLineError(err?.message ?? "Unable to save stock counts.");
    } finally {
      setLineSaving(false);
    }
  };

  const sortedInternalNotes = useMemo(() => {
    if (!purchase) return [];
    return [...purchase.internalNotes].sort((a, b) => {
      const aTime =
        a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : 0;
      const bTime =
        b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    });
  }, [purchase]);

  const handleAttachmentUpload = async (
    e: ChangeEvent<HTMLInputElement>,
  ) => {
    if (!purchase) return;
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadingFiles(true);
    setAttachmentError(null);
    setAttachmentMessage(null);
    const now = Timestamp.now();
    try {
      const uploads: PurchaseAttachment[] = await Promise.all(
        Array.from(files).map(async (file) => {
          const dataUrl = await readFileAsDataUrl(file);
          return {
            id: `${purchase.id}-file-${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: file.name,
            size: file.size,
            type: file.type,
            dataUrl,
            uploadedAt: now,
          };
        }),
      );

      const nextAttachments = [...purchase.attachments, ...uploads];
      await updateDoc(doc(db, "purchases", purchase.id), {
        attachments: nextAttachments,
        updatedAt: now,
      });
      setPurchase((prev) =>
        prev ? { ...prev, attachments: nextAttachments } : prev,
      );
      setAttachmentMessage(
        uploads.length === 1
          ? `${uploads[0].name} uploaded.`
          : `${uploads.length} files uploaded.`,
      );
      e.target.value = "";
    } catch (err: any) {
      console.error("Error uploading attachments", err);
      setAttachmentError(err?.message ?? "Unable to upload files.");
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleAddNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!purchase) return;
    const trimmed = newNote.trim();
    if (!trimmed) {
      setNoteError("Add some detail to the internal note.");
      return;
    }
    setNoteSaving(true);
    setNoteError(null);
    const now = Timestamp.now();
    const note: PurchaseNote = {
      id: `${purchase.id}-note-${now.toMillis()}`,
      body: trimmed,
      createdAt: now,
    };
    const nextNotes = [note, ...purchase.internalNotes];
    try {
      await updateDoc(doc(db, "purchases", purchase.id), {
        internalNotes: nextNotes,
        updatedAt: now,
      });
      setPurchase((prev) =>
        prev ? { ...prev, internalNotes: nextNotes } : prev,
      );
      setNewNote("");
    } catch (err: any) {
      console.error("Error saving note", err);
      setNoteError(err?.message ?? "Unable to save note.");
    } finally {
      setNoteSaving(false);
    }
  };

  return (
    <main className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Purchase details</h1>
          <p className="ims-page-subtitle">
            Supplier, pricing and the exact items received in this purchase.
          </p>
        </div>
        <div className="ims-page-actions">
          <Link href="/purchasing/history" className="ims-secondary-button">
            ← Back to history
          </Link>
          <Link href="/purchasing" className="ims-primary-button">
            + Log new purchase
          </Link>
        </div>
      </div>

      {loading && (
        <div className="ims-alert ims-alert--info">Loading purchase…</div>
      )}
      {error && <div className="ims-alert ims-alert--error">{error}</div>}

      {!loading && !error && !purchase && (
        <p className="ims-table-empty">
          Unable to locate this purchase. It may have been deleted.
        </p>
      )}

      {purchase && (
        <>
          <section className="ims-form-section card">
            <h2 className="ims-form-section-title">
              {purchase.vendorName}
            </h2>
            <p className="ims-form-section-subtitle">
              Logged on {formatDate(purchase.purchaseDate)}{" "}
              {purchase.reference ? `• Ref ${purchase.reference}` : ""}
            </p>

            <div
              className="ims-field"
              style={{
                maxWidth: "260px",
                marginTop: "1rem",
              }}
            >
              <label className="ims-field-label" htmlFor="purchaseStatus">
                Purchase status
              </label>
              <select
                id="purchaseStatus"
                className="ims-status-select"
                style={{
                  backgroundColor: statusTheme.bg,
                  color: statusTheme.color,
                  borderColor: statusTheme.border,
                }}
                value={purchase.status}
                onChange={(e) =>
                  handleStatusChange(e.target.value as PurchaseStatus)
                }
                disabled={statusUpdating}
              >
                {(Object.keys(statusThemes) as PurchaseStatus[]).map((key) => (
                  <option key={key} value={key}>
                    {statusThemes[key].label}
                  </option>
                ))}
              </select>
              {statusMessage && (
                <p
                  className="ims-field-help"
                  style={{ color: "#059669" }}
                >
                  {statusMessage}
                </p>
              )}
              {statusError && (
                <p
                  className="ims-field-help"
                  style={{ color: "#b91c1c" }}
                >
                  {statusError}
                </p>
              )}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "1rem",
              }}
            >
              <div className="ims-field">
                <label className="ims-field-label">Vendor / supplier</label>
                <div>{purchase.vendorName}</div>
              </div>
              <div className="ims-field">
                <label className="ims-field-label">Reference</label>
                <div>{purchase.reference || "—"}</div>
              </div>
              <div className="ims-field">
                <label className="ims-field-label">Purchase date</label>
                <div>{formatDate(purchase.purchaseDate)}</div>
              </div>
              <div className="ims-field">
                <label className="ims-field-label">Logged</label>
                <div>{formatDate(purchase.createdAt)}</div>
              </div>
              <div className="ims-field">
                <label className="ims-field-label">Total amount</label>
                <div>{formatCurrency(purchase.totalAmount)}</div>
              </div>
            </div>

            {purchase.notes && (
              <div className="ims-field" style={{ marginTop: "1rem" }}>
                <label className="ims-field-label">Notes</label>
                <div>{purchase.notes}</div>
              </div>
            )}
          </section>

          <section className="ims-table-card card">
            <div className="ims-table-header">
              <div>
                <h2 className="ims-form-section-title">Line items</h2>
                <p className="ims-form-section-subtitle">
                  Products, quantities and unit prices recorded for this
                  purchase.{" "}
                  {canEditStockCounts
                    ? "Update the stock counts below to match what was received."
                    : 'Stock counts unlock once the status is "Stock received".'}
                </p>
              </div>
            </div>
            <div className="ims-table-wrapper">
              <table className="ims-table">
                <thead>
                  <tr>
                    <th style={{ width: "35%" }}>Product</th>
                    <th>SKU</th>
                    <th>Quantity</th>
                    <th>Unit price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {purchase.lineItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center" }}>
                        No line items captured for this purchase.
                      </td>
                    </tr>
                  ) : (
                    purchase.lineItems.map((line, idx) => {
                      const fallbackQuantity =
                        typeof line.quantity === "number"
                          ? String(line.quantity)
                          : "";
                      const draftValue = lineDrafts[idx] ?? fallbackQuantity;
                      const parsedDraft =
                        draftValue.trim() === ""
                          ? null
                          : Number(draftValue);
                      const qtyForTotal =
                        canEditStockCounts &&
                        parsedDraft != null &&
                        Number.isFinite(parsedDraft)
                          ? parsedDraft
                          : line.quantity ?? null;
                      const price =
                        typeof line.unitPrice === "number"
                          ? line.unitPrice
                          : null;
                      const value =
                        price != null && qtyForTotal != null
                          ? price * qtyForTotal
                          : line.lineTotal ?? null;

                      return (
                        <tr key={`${line.itemId ?? idx}-${idx}`}>
                          <td>{line.name || "Unnamed item"}</td>
                          <td>{line.sku || "—"}</td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              className="ims-field-input"
                              value={draftValue}
                              onChange={(e) =>
                                handleLineDraftChange(idx, e.target.value)
                              }
                              disabled={!canEditStockCounts}
                            />
                          </td>
                          <td>{formatCurrency(price)}</td>
                          <td>{formatCurrency(value)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {canEditStockCounts && purchase.lineItems.length > 0 && (
              <div
                style={{
                  marginTop: "1rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.4rem",
                  alignItems: "flex-start",
                }}
              >
                <button
                  type="button"
                  className="ims-primary-button"
                  onClick={handleSaveLineCounts}
                  disabled={!lineChangesPending || lineSaving}
                >
                  {lineSaving ? "Saving…" : "Save stock counts"}
                </button>
                {lineMessage && (
                  <p className="ims-field-help" style={{ color: "#059669" }}>
                    {lineMessage}
                  </p>
                )}
                {lineError && (
                  <p className="ims-field-help" style={{ color: "#b91c1c" }}>
                    {lineError}
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="ims-form-section card">
            <div className="ims-table-header" style={{ marginBottom: "1rem" }}>
              <div>
                <h2 className="ims-form-section-title">Attachments</h2>
                <p className="ims-form-section-subtitle">
                  Upload purchase orders, invoices or delivery paperwork to keep
                  this PO complete.
                </p>
              </div>
              <div>
                <label className="ims-secondary-button ims-file-label">
                  <input
                    type="file"
                    multiple
                    style={{ display: "none" }}
                    onChange={handleAttachmentUpload}
                    disabled={uploadingFiles}
                  />
                  {uploadingFiles ? "Uploading…" : "Upload files"}
                </label>
              </div>
            </div>
            {attachmentMessage && (
              <p className="ims-field-help" style={{ color: "#059669" }}>
                {attachmentMessage}
              </p>
            )}
            {attachmentError && (
              <p className="ims-field-help" style={{ color: "#b91c1c" }}>
                {attachmentError}
              </p>
            )}
            {purchase.attachments.length === 0 ? (
              <p className="ims-table-empty">
                No files uploaded yet. Attach documents for future reference.
              </p>
            ) : (
              <div className="ims-table-wrapper">
                <table className="ims-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Size</th>
                      <th>Uploaded</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {purchase.attachments.map((file) => (
                      <tr key={file.id}>
                        <td>{file.name}</td>
                        <td>
                          {(file.size / 1024).toFixed(1)} KB
                        </td>
                        <td>{formatDate(file.uploadedAt)}</td>
                        <td>
                          <a
                            href={file.dataUrl}
                            download={file.name}
                            className="ims-table-link"
                          >
                            Download
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="ims-form-section card">
            <div className="ims-table-header" style={{ marginBottom: "1rem" }}>
              <div>
                <h2 className="ims-form-section-title">Internal notes</h2>
                <p className="ims-form-section-subtitle">
                  Share context, chasing updates or supplier comms. Notes are
                  timestamped and visible only in this workspace.
                </p>
              </div>
            </div>
            <form onSubmit={handleAddNote} style={{ marginBottom: "1rem" }}>
              <label className="ims-field-label" htmlFor="poNote">
                Add note
              </label>
              <textarea
                id="poNote"
                className="ims-field-input ims-field-textarea"
                rows={3}
                placeholder="Reminder, update or internal context…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
              {noteError && (
                <p className="ims-field-help" style={{ color: "#b91c1c" }}>
                  {noteError}
                </p>
              )}
              <button
                type="submit"
                className="ims-primary-button"
                style={{ marginTop: "0.5rem" }}
                disabled={noteSaving}
              >
                {noteSaving ? "Saving…" : "Add note"}
              </button>
            </form>

            {sortedInternalNotes.length === 0 ? (
              <p className="ims-table-empty">No notes yet.</p>
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                }}
              >
                {sortedInternalNotes.map((note) => (
                  <li
                    key={note.id}
                    style={{
                      padding: "0.75rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #e5e7eb",
                      backgroundColor: "#f9fafb",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.75rem",
                        textTransform: "uppercase",
                        color: "#6b7280",
                        marginBottom: "0.35rem",
                      }}
                    >
                      Added {formatDate(note.createdAt)}
                    </div>
                    <div>{note.body}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
