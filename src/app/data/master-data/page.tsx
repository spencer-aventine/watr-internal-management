// src/app/data/master-data/page.tsx
"use client";

import Link from "next/link";

const cards = [
  { label: "Products", href: "/inventory/new?type=products" },
  { label: "Sub-assemblies", href: "/inventory/sub-assemblies/new" },
  { label: "Components", href: "/inventory/new?type=components" },
  { label: "Sensors", href: "/inventory/new?type=sensors" },
  { label: "Sensor extras", href: "/inventory/new?type=sensorExtras" },
];

export default function MasterDataPage() {
  return (
    <main className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Master data</h1>
          <p className="ims-page-subtitle">
            Add new inventory records from a single place instead of cluttering the
            inventory list. Choose the type you want to create below.
          </p>
        </div>
        <div className="ims-page-actions">
          <Link href="/inventory" className="ims-secondary-button">
            ← Back to inventory
          </Link>
        </div>
      </div>

      <section className="ims-form-grid">
        {cards.map((card) => (
          <div key={card.href} className="ims-form-section card">
            <h2 className="ims-form-section-title">{card.label}</h2>
            <p className="ims-form-section-subtitle">
              Create a new {card.label.toLowerCase()} record.
            </p>
            <Link href={card.href} className="ims-primary-button">
              Add {card.label.toLowerCase()}
            </Link>
          </div>
        ))}
      </section>
    </main>
  );
}
