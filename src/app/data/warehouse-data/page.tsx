// src/app/data/warehouse-data/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, Timestamp } from "firebase/firestore";
import Link from "next/link";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/_components/AuthProvider";
import {
  fetchWarehouseLocationDocs,
  WAREHOUSE_LOCATION_DEFAULTS,
} from "@/lib/warehouseLocations";

type LocationRow = {
  id: string | null;
  name: string;
  isDefault: boolean;
};

export default function WarehouseDataPage() {
  const { canEdit } = useAuth();
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newLocation, setNewLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadLocations = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchWarehouseLocationDocs();
      const defaults = new Set(WAREHOUSE_LOCATION_DEFAULTS.map((n) => n.toLowerCase()));
      const mapped: LocationRow[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        isDefault: row.isDefault || defaults.has(row.name.toLowerCase()),
      }));
      setLocations(mapped);
    } catch (err: any) {
      console.error("Error loading warehouse locations", err);
      setError(err?.message ?? "Unable to load warehouse locations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLocations();
  }, []);

  const sortedLocations = useMemo(() => {
    return [...locations].sort((a, b) => {
      if (a.isDefault !== b.isDefault) {
        return a.isDefault ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [locations]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const trimmed = newLocation.trim();
    if (!trimmed) {
      setError("Enter a location name.");
      return;
    }
    const exists = locations.some(
      (loc) => loc.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exists) {
      setError("That location already exists.");
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, "warehouseLocations"), {
        name: trimmed,
        createdAt: Timestamp.now(),
      });
      setNewLocation("");
      setMessage("Location added.");
      await loadLocations();
    } catch (err: any) {
      console.error("Error adding warehouse location", err);
      setError(err?.message ?? "Unable to add this location.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: LocationRow) => {
    if (row.isDefault || !row.id) return;
    setError(null);
    setMessage(null);
    setDeletingId(row.id);
    try {
      await deleteDoc(doc(db, "warehouseLocations", row.id));
      setMessage("Location deleted.");
      await loadLocations();
    } catch (err: any) {
      console.error("Error deleting warehouse location", err);
      setError(err?.message ?? "Unable to delete this location.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Warehouse data</h1>
          <p className="ims-page-subtitle">
            Manage storage locations used across inventory and sub-assembly workflows.
          </p>
        </div>
        <div className="ims-page-actions">
          <Link href="/data" className="ims-secondary-button">
            ← Back to data
          </Link>
        </div>
      </div>

      {(error || message) && (
        <div
          className={"ims-alert " + (error ? "ims-alert--error" : "ims-alert--info")}
          style={{ maxWidth: 720 }}
        >
          {error || message}
        </div>
      )}

      <div className="ims-form-grid">
        <section className="ims-form-section card">
          <h2 className="ims-form-section-title">Add location</h2>
          <p className="ims-form-section-subtitle">
            Defaults include Downstairs, Upstairs and Container. Add more as your
            warehouse layout grows.
          </p>
          <form className="ims-form-stack" onSubmit={handleSubmit} style={{ gap: "0.5rem" }}>
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="locationName">
                Location name
              </label>
              <input
                id="locationName"
                className="ims-field-input"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                placeholder="e.g. Mezzanine rack A"
                disabled={!canEdit || saving}
              />
            </div>
            <div className="ims-form-actions">
              <button
                type="submit"
                className="ims-primary-button"
                disabled={!canEdit || saving}
              >
                {saving ? "Saving…" : "Add location"}
              </button>
              {!canEdit && (
                <p className="ims-field-help">
                  You need edit access to add locations. Contact an admin if this is incorrect.
                </p>
              )}
            </div>
          </form>
        </section>

        <section className="ims-form-section card">
          <div className="ims-table-header">
            <div>
              <h2 className="ims-form-section-title">Current locations</h2>
              <p className="ims-form-section-subtitle">
                Listed in the order they&apos;ll appear in forms. Defaults are pinned first.
              </p>
            </div>
            <span className="ims-table-count">
              {sortedLocations.length} location{sortedLocations.length === 1 ? "" : "s"}
            </span>
          </div>
          {loading ? (
            <p className="ims-table-empty">Loading locations…</p>
          ) : sortedLocations.length === 0 ? (
            <p className="ims-table-empty">No locations yet.</p>
          ) : (
            <div className="ims-table-wrapper">
              <table className="ims-table ims-table--compact">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th style={{ width: "140px" }}>Type</th>
                    <th style={{ width: "120px" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLocations.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td>{row.isDefault ? "Default" : "Custom"}</td>
                      <td>
                        {row.isDefault || !row.id ? (
                          <span className="ims-table-muted">—</span>
                        ) : (
                          <button
                            type="button"
                            className="ims-text-button"
                            aria-label={`Delete ${row.name}`}
                            disabled={
                              deletingId === row.id || !canEdit
                            }
                            onClick={() => handleDelete(row)}
                            style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 16 16"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                              aria-hidden="true"
                            >
                              <path
                                d="M6 2h4l.5 1H13v1H3V3h2.5L6 2Zm-2 3h8l-.5 8.5a1 1 0 0 1-1 .95H5.5a1 1 0 0 1-1-.95L4 5Zm3 2v5h1V7H7Zm2 0v5h1V7H9Z"
                                fill="currentColor"
                              />
                            </svg>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
