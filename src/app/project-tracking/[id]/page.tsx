// src/app/project-tracking/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { db } from "@/lib/firebase";
import { getInventoryDetailPath } from "@/lib/inventoryPaths";
import { PROJECT_ITEM_LABELS } from "@/app/projects/_projectItemUtils";
import {
  doc,
  getDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { replenishTrackedProduct } from "@/lib/productTracking";
import { useAuth } from "@/app/_components/AuthProvider";

type TrackingRecord = {
  id: string;
  projectId: string;
  projectName: string;
  itemId: string;
  itemName: string;
  itemType?: string | null;
  itemCategory?: string | null;
  quantity: number;
  usefulLifeMonths: number | null;
  trackingType?: "usefulLife" | "sensorExtra";
  replacementFrequencyPerYear?: number | null;
  completedAt?: Timestamp | null;
  replaceBy?: Timestamp | null;
  replenished?: boolean;
  replenishedAt?: Timestamp | null;
  lastReplenishedAt?: Timestamp | null;
  notes: TrackingNote[];
};

type TrackingNote = {
  id: string;
  body: string;
  createdAt?: Timestamp | null;
  createdByEmail?: string | null;
};

const formatDate = (value?: Timestamp | null) => {
  if (!value) return "—";
  try {
    return value.toDate().toLocaleString();
  } catch {
    return "—";
  }
};

const formatDuration = (months?: number | null) => {
  if (months == null || !Number.isFinite(months) || months <= 0) return "—";
  if (months === 1) return "1 month";
  return `${months} months`;
};

const addNoteToRecord = async (
  trackingId: string,
  body: string,
  author?: string | null,
) => {
  const ref = doc(db, "productTracking", trackingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error("Tracking record not found");
  }
  const data = snap.data() as any;
  const notes: TrackingNote[] = Array.isArray(data.notes)
    ? data.notes
    : [];
  const now = Timestamp.now();
  const newNote: TrackingNote = {
    id: `${trackingId}-note-${now.toMillis()}`,
    body,
    createdAt: now,
    createdByEmail: author ?? "unknown",
  };
  const updatedNotes = [newNote, ...notes];
  await updateDoc(ref, {
    notes: updatedNotes,
    updatedAt: now,
  });
  return updatedNotes;
};

export default function ProjectTrackingDetailPage() {
  const params = useParams<{ id: string }>();
  const trackingId = params?.id;
  const { user } = useAuth();
  const [record, setRecord] = useState<TrackingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [showReplenishForm, setShowReplenishForm] = useState(false);
  const [nextReplenishDate, setNextReplenishDate] = useState("");

  useEffect(() => {
    const load = async () => {
      if (!trackingId) return;
      setLoading(true);
      setError(null);
      try {
        const ref = doc(db, "productTracking", trackingId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setError("Tracking record not found.");
          setRecord(null);
          return;
        }
        const data = snap.data() as any;
        setRecord({
          id: snap.id,
          projectId: data.projectId ?? "",
          projectName: data.projectName ?? "Unnamed project",
          itemId: data.itemId ?? "",
          itemName: data.itemName ?? "Unknown item",
          itemType: data.itemType ?? null,
          itemCategory: data.itemCategory ?? data.category ?? null,
          quantity: typeof data.quantity === "number" ? data.quantity : 0,
          usefulLifeMonths:
            typeof data.usefulLifeMonths === "number"
              ? data.usefulLifeMonths
              : null,
          trackingType: data.trackingType ?? null,
          replacementFrequencyPerYear:
            typeof data.replacementFrequencyPerYear === "number"
              ? data.replacementFrequencyPerYear
              : null,
          completedAt: data.completedAt ?? null,
          replaceBy: data.replaceBy ?? null,
          replenished: Boolean(data.replenished),
          replenishedAt: data.replenishedAt ?? null,
          lastReplenishedAt: data.lastReplenishedAt ?? null,
          notes: Array.isArray(data.notes)
            ? data.notes.map((note: any) => ({
                id: note.id ?? `note-${Math.random()}`,
                body: note.body ?? "",
                createdAt: note.createdAt ?? null,
                createdByEmail: note.createdByEmail ?? note.author ?? "unknown",
              }))
            : [],
        });
      } catch (err: any) {
        console.error("Error loading tracking record", err);
        setError(err?.message ?? "Unable to load tracking record.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [trackingId]);

  useEffect(() => {
    if (record?.replaceBy instanceof Timestamp) {
      setNextReplenishDate(
        record.replaceBy.toDate().toISOString().split("T")[0],
      );
    } else {
      setNextReplenishDate(new Date().toISOString().split("T")[0]);
    }
  }, [record?.replaceBy]);

  const handleReplenish = async () => {
    if (!record || record.replenished) return;
    if (!nextReplenishDate) {
      setActionError("Select the next replenish date before confirming.");
      return;
    }
    const parsed = new Date(nextReplenishDate);
    if (Number.isNaN(parsed.getTime())) {
      setActionError("Enter a valid next replenish date.");
      return;
    }
    setProcessing(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await replenishTrackedProduct(record.id, Timestamp.fromDate(parsed));
      const now = Timestamp.now();
      setRecord((prev) =>
        prev
          ? {
              ...prev,
              replenished: true,
              replenishedAt: now,
              lastReplenishedAt: now,
            }
          : prev,
      );
      setActionMessage("Product marked as replenished.");
      setShowReplenishForm(false);
    } catch (err: any) {
      console.error("Error replenishing product", err);
      setActionError(err?.message ?? "Unable to replenish this product.");
    } finally {
      setProcessing(false);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record) return;
    const trimmed = note.trim();
    if (!trimmed) {
      setActionError("Enter a note before saving.");
      return;
    }
    setSavingNote(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const updatedNotes = await addNoteToRecord(
        record.id,
        trimmed,
        user?.email ?? "unknown",
      );
      setRecord((prev) => (prev ? { ...prev, notes: updatedNotes } : prev));
      setNote("");
      setActionMessage("Note saved.");
    } catch (err: any) {
      console.error("Error saving note", err);
      setActionError(err?.message ?? "Unable to save note.");
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <main className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Product tracking detail</h1>
          <p className="ims-page-subtitle">
            Useful life and replacement information for completed project
            installs.
          </p>
        </div>
        <div className="ims-page-actions">
          <Link href="/project-tracking" className="ims-secondary-button">
            ← Back to tracking list
          </Link>
        </div>
      </div>

      {loading ? (
        <p className="ims-table-empty">Loading tracking record…</p>
      ) : error ? (
        <div className="ims-alert ims-alert--error">{error}</div>
      ) : !record ? (
        <p className="ims-table-empty">Tracking record not found.</p>
      ) : (
        <section className="card ims-form-section">
          {actionMessage && (
            <div className="ims-alert ims-alert--info">{actionMessage}</div>
          )}
          {actionError && (
            <div className="ims-alert ims-alert--error">{actionError}</div>
          )}

          <div className="ims-field">
            <label className="ims-field-label">Project</label>
            <div>
              <Link
                href={`/projects/${record.projectId}`}
                className="ims-table-link"
              >
                {record.projectName}
              </Link>
            </div>
          </div>

          <div className="ims-field">
            <label className="ims-field-label">Product</label>
            <div>
              <Link
                href={getInventoryDetailPath(
                  record.itemId,
                  record.itemType,
                  record.itemCategory,
                )}
                className="ims-table-link"
              >
                {record.itemName}
              </Link>
            </div>
          </div>

          <div className="ims-field-row">
            <div className="ims-field">
              <label className="ims-field-label">Quantity</label>
              <div>{record.quantity}</div>
            </div>
            <div className="ims-field">
              <label className="ims-field-label">Type</label>
              <div>
                {record.itemType
                  ? PROJECT_ITEM_LABELS[
                      (record.itemType as keyof typeof PROJECT_ITEM_LABELS) ??
                        "components"
                    ]
                  : "Item"}
              </div>
            </div>
          </div>

          <div className="ims-field-row">
            <div className="ims-field">
              <label className="ims-field-label">Replacement plan</label>
              <div>
                {record.trackingType === "sensorExtra"
                  ? record.replacementFrequencyPerYear
                    ? `${record.replacementFrequencyPerYear} / year`
                    : "—"
                  : formatDuration(record.usefulLifeMonths)}
              </div>
            </div>
            <div className="ims-field">
              <label className="ims-field-label">Completed</label>
              <div>{formatDate(record.completedAt)}</div>
            </div>
          </div>

          <div className="ims-field-row">
            <div className="ims-field">
              <label className="ims-field-label">Replacement due</label>
              <div>{formatDate(record.replaceBy)}</div>
            </div>
            <div className="ims-field">
              <label className="ims-field-label">Last replenished</label>
              <div>{formatDate(record.lastReplenishedAt)}</div>
            </div>
          </div>

          <div className="ims-field">
            <label className="ims-field-label">Status</label>
            <div>
              {record.replenished ? (
                <>
                  <span
                    style={{
                      padding: "0.15rem 0.6rem",
                      borderRadius: "999px",
                      backgroundColor: "#dbeafe",
                      color: "#1d4ed8",
                      fontWeight: 600,
                    }}
                  >
                    Replenished
                  </span>
                  <div style={{ marginTop: "0.35rem" }}>
                    Replenished at: {formatDate(record.replenishedAt)}
                  </div>
                </>
              ) : (
                <span>Active</span>
              )}
            </div>
          </div>

          {!record.replenished && (
            <div
              className="ims-form-actions"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "0.75rem",
              }}
            >
              {showReplenishForm ? (
                <>
                  <div className="ims-field" style={{ maxWidth: "260px" }}>
                    <label
                      className="ims-field-label"
                      htmlFor="nextReplenishDate"
                    >
                      Next replenish date
                    </label>
                    <input
                      id="nextReplenishDate"
                      type="date"
                      className="ims-field-input"
                      value={nextReplenishDate}
                      onChange={(e) => setNextReplenishDate(e.target.value)}
                    />
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <button
                      type="button"
                      className="ims-secondary-button"
                      onClick={() => setShowReplenishForm(false)}
                      disabled={processing}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="ims-primary-button"
                      onClick={handleReplenish}
                      disabled={processing}
                    >
                      {processing ? "Marking…" : "Confirm replenishment"}
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="ims-primary-button"
                  onClick={() => setShowReplenishForm(true)}
                >
                  Mark as replenished
                </button>
              )}
            </div>
          )}

          <div className="ims-field" style={{ marginTop: "1.5rem" }}>
            <label className="ims-field-label">Notes</label>
            {record.notes.length === 0 ? (
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
                {record.notes.map((n) => (
                  <li
                    key={n.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: "0.5rem",
                      padding: "0.75rem",
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
                      {formatDate(n.createdAt)}{" "}
                      {n.createdByEmail ? `• ${n.createdByEmail}` : ""}
                    </div>
                    <div>{n.body}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={handleAddNote} style={{ marginTop: "1rem" }}>
            <label className="ims-field-label" htmlFor="trackingNote">
              Add note
            </label>
            <textarea
              id="trackingNote"
              className="ims-field-input ims-field-textarea"
              rows={3}
              placeholder="Context, replacement info or next steps…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              type="submit"
              className="ims-secondary-button"
              style={{ marginTop: "0.5rem" }}
              disabled={savingNote}
            >
              {savingNote ? "Saving…" : "Save note"}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
