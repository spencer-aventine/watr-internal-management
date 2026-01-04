// src/app/data/page.tsx
"use client";

import Link from "next/link";
import { useAuth } from "../_components/AuthProvider";

export default function DataHomePage() {
  const { user, isAdmin } = useAuth();
  const showWarehouseCard = Boolean(user && isAdmin);

  return (
    <main className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Data</h1>
          <p className="ims-page-subtitle">
            Manage reference data such as warehouse locations and supplier records.
          </p>
        </div>
      </div>

      <div className="ims-form-grid">
        {showWarehouseCard && (
          <section className="ims-form-section card">
            <h2 className="ims-form-section-title">Warehouse data</h2>
            <p className="ims-form-section-subtitle">
              Keep the list of storage locations up to date for assemblies and inventory.
            </p>
            <Link href="/data/warehouse-data" className="ims-primary-button">
              Manage locations
            </Link>
          </section>
        )}

        <section className="ims-form-section card">
          <h2 className="ims-form-section-title">Suppliers</h2>
          <p className="ims-form-section-subtitle">
            View and edit supplier records used across purchasing and inventory.
          </p>
          <Link href="/suppliers" className="ims-secondary-button">
            Go to suppliers
          </Link>
        </section>

        <section className="ims-form-section card">
          <h2 className="ims-form-section-title">Admin</h2>
          <p className="ims-form-section-subtitle">
            Adjust user permissions and access levels for the IMS.
          </p>
          <Link href="/admin" className="ims-secondary-button">
            Go to admin
          </Link>
        </section>
      </div>
    </main>
  );
}
