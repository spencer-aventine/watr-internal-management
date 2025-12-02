// src/app/_components/ImsShell.tsx
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "Inventory", href: "/inventory" },
  { label: "Purchasing", href: "/purchasing" },
  { label: "WIP & Completions", href: "/projects" },
  { label: "Assets", href: "/assets" },
  { label: "Reporting", href: "/reporting" },
  { label: "Integrations", href: "/integrations" },
  { label: "Admin", href: "/admin" },
];

export default function ImsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <div className="ims-shell">
      {/* Sidebar */}
      <aside className="ims-sidebar">
        <div className="ims-sidebar-header">
          <div className="ims-logo-mark">
            <Image
              src="/logo.png" // ✅ in /public/logo.png
              alt="WATR logo"
              width={32}
              height={32}
              className="ims-logo-img"
            />
          </div>
          <div className="ims-logo-text">
            <span className="ims-logo-title">WATR IMS</span>
            <span className="ims-logo-subtitle">Inventory & Projects</span>
          </div>
        </div>

        <nav className="ims-sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={
                "ims-sidebar-link" +
                (isActive(item.href) ? " ims-sidebar-link--active" : "")
              }
              aria-current={isActive(item.href) ? "page" : undefined}
            >
              <span className="ims-sidebar-dot" />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>

      {/* Main column */}
      <div className="ims-main">
        <header className="ims-header">
          {/* Left spacer (no search bar) */}
          <div />
          <div className="ims-header-actions">
            <button className="ims-icon-button" aria-label="Notifications">
              🔔
            </button>
            <Link href="/inventory/new" className="ims-add-button">
              + Add Product
            </Link>
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}
